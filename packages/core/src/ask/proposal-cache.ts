import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ayd/database';
import { PrismaService } from '../prisma/prisma.service';

/** A model's SQL proposal that passed the guard and ran. Never any result rows. */
export interface CachedProposal {
  sql: string;
  assumptions: string[];
  explanation: string;
  model: string;
}

/**
 * Validated proposals by connection, schema fingerprint, and question (blueprint 7). The
 * fingerprint changes with every schema refresh and allowlist edit (ADR 0008), so an old
 * entry stops matching on its own. A cached proposal is still checked by the guard and can
 * be dropped if it no longer passes or no longer runs.
 */
export interface ProposalCache {
  /** The entry, if any; a hit is counted. */
  find(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
  ): Promise<CachedProposal | null>;
  /** Stores the entry, and drops the connection's entries for older fingerprints. */
  save(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
    proposal: CachedProposal,
  ): Promise<void>;
  forget(connectionId: string, fingerprint: string, questionKey: string): Promise<void>;
}

export const PROPOSAL_CACHE = Symbol('PROPOSAL_CACHE');

/**
 * The same question asked another way should hit the same entry: case, extra spaces, and
 * trailing punctuation do not change the key.
 */
export function normalizeQuestion(question: string): string {
  return question
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?.!\s]+$/, '');
}

/** The cache key for a question: a hash, so the key column holds no question text. */
export function questionKey(question: string): string {
  return createHash('sha256').update(normalizeQuestion(question)).digest('hex');
}

@Injectable()
export class PrismaProposalCache implements ProposalCache {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
  ): Promise<CachedProposal | null> {
    const where = {
      connectionId_fingerprint_questionHash: {
        connectionId,
        fingerprint,
        questionHash: questionKey,
      },
    };
    const row = await this.prisma.queryCacheEntry.findUnique({ where });
    if (!row) {
      return null;
    }
    await this.prisma.queryCacheEntry.update({
      where,
      data: { hits: { increment: 1 }, lastUsedAt: new Date() },
    });
    return {
      sql: row.sql,
      assumptions: Array.isArray(row.assumptions) ? (row.assumptions as string[]) : [],
      explanation: row.explanation,
      model: row.model,
    };
  }

  async save(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
    proposal: CachedProposal,
  ): Promise<void> {
    const fields = {
      sql: proposal.sql,
      assumptions: proposal.assumptions as Prisma.InputJsonArray,
      explanation: proposal.explanation,
      model: proposal.model,
    };
    await this.prisma.$transaction([
      this.prisma.queryCacheEntry.deleteMany({
        where: { connectionId, fingerprint: { not: fingerprint } },
      }),
      this.prisma.queryCacheEntry.upsert({
        where: {
          connectionId_fingerprint_questionHash: {
            connectionId,
            fingerprint,
            questionHash: questionKey,
          },
        },
        create: {
          id: randomUUID(),
          connectionId,
          fingerprint,
          questionHash: questionKey,
          ...fields,
        },
        update: { ...fields, lastUsedAt: new Date() },
      }),
    ]);
  }

  async forget(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
  ): Promise<void> {
    await this.prisma.queryCacheEntry.deleteMany({
      where: { connectionId, fingerprint, questionHash: questionKey },
    });
  }
}
