import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { QueryCacheEntry } from '@ayd/database';
import { Op, literal } from 'sequelize';
import { DatabaseService } from '../database/database.service';

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
export class SequelizeProposalCache implements ProposalCache {
  constructor(private readonly db: DatabaseService) {}

  async find(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
  ): Promise<CachedProposal | null> {
    const where = { connectionId, fingerprint, questionHash: questionKey };
    const row = await QueryCacheEntry.findOne({ where });
    if (!row) {
      return null;
    }
    // hits + 1 is computed by Postgres, so two hits at the same moment both count.
    await QueryCacheEntry.update(
      { hits: literal('hits + 1'), lastUsedAt: new Date() },
      { where },
    );
    return {
      sql: row.sql,
      assumptions: Array.isArray(row.assumptions) ? row.assumptions : [],
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
    await this.db.transaction(async (transaction) => {
      await QueryCacheEntry.destroy({
        where: { connectionId, fingerprint: { [Op.ne]: fingerprint } },
        transaction,
      });
      // INSERT ... ON CONFLICT (connection_id, fingerprint, question_hash) DO UPDATE SET
      // only the listed columns, so an existing entry keeps its id, hits, and created_at.
      await QueryCacheEntry.bulkCreate(
        [
          {
            id: randomUUID(),
            connectionId,
            fingerprint,
            questionHash: questionKey,
            sql: proposal.sql,
            assumptions: proposal.assumptions,
            explanation: proposal.explanation,
            model: proposal.model,
            lastUsedAt: new Date(),
          },
        ],
        {
          conflictAttributes: ['connectionId', 'fingerprint', 'questionHash'],
          updateOnDuplicate: ['sql', 'assumptions', 'explanation', 'model', 'lastUsedAt'],
          transaction,
        },
      );
    });
  }

  async forget(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
  ): Promise<void> {
    await QueryCacheEntry.destroy({
      where: { connectionId, fingerprint, questionHash: questionKey },
    });
  }
}
