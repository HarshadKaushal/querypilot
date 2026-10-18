import type { Optional } from 'sequelize';

/**
 * A query_cache row: a validated SQL proposal, so a repeated question skips the model
 * (blueprint 7). The key is the connection, the allowlisted schema's fingerprint, and a
 * hash of the normalized question. Never holds result rows.
 */
export interface QueryCacheEntryAttributes {
  id: string;
  connectionId: string;
  fingerprint: string;
  questionHash: string;
  sql: string;
  assumptions: string[];
  explanation: string;
  model: string;
  hits: number;
  createdAt: Date;
  lastUsedAt: Date;
}

/** What creating a row needs. Columns that may be null or have a default can be left out. */
export type QueryCacheEntryCreationAttributes = Optional<
  QueryCacheEntryAttributes,
  'hits' | 'createdAt' | 'lastUsedAt'
>;
