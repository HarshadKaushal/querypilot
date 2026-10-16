import type { Optional } from 'sequelize';
import type { QueryKind } from '../enums/query-kind.enum';
import type { QueryStatus } from '../enums/query-status.enum';

/**
 * A queries row: one finished question or SQL job, for the owner's history (blueprint 7 and
 * 8.4). Never result rows; the summary only names values the summary model was allowed to see.
 */
export interface QueryRecordAttributes {
  id: string;
  userId: string;
  connectionId: string;
  kind: QueryKind;
  question: string | null;
  sql: string | null;
  status: QueryStatus;
  errorCode: string | null;
  rowCount: number | null;
  truncated: string | null;
  schemaVersion: number | null;
  cached: boolean;
  summary: string | null;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  llmMs: number;
  queryMs: number;
  totalMs: number;
  /** When the job was submitted. Set by the caller, not by Sequelize. */
  createdAt: Date;
  finishedAt: Date;
}

/** What creating a row needs. Columns that may be null or have a default can be left out. */
export type QueryRecordCreationAttributes = Optional<
  QueryRecordAttributes,
  | 'question'
  | 'sql'
  | 'errorCode'
  | 'rowCount'
  | 'truncated'
  | 'schemaVersion'
  | 'cached'
  | 'summary'
  | 'inputTokens'
  | 'outputTokens'
  | 'llmMs'
  | 'queryMs'
  | 'totalMs'
  | 'finishedAt'
>;
