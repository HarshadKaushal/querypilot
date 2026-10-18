import { createHash } from 'node:crypto';

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
