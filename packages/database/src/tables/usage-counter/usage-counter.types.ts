import type { Optional } from 'sequelize';

/** A usage_counters row: one user's totals for one UTC day (blueprint 7). */
export interface UsageCounterAttributes {
  userId: string;
  /** The UTC day as YYYY-MM-DD. A DATE column, which Sequelize reads as a string. */
  day: string;
  questions: number;
  rowsReturned: number;
  inputTokens: number;
  outputTokens: number;
}

/** What creating a row needs. Columns that may be null or have a default can be left out. */
export type UsageCounterCreationAttributes = Optional<
  UsageCounterAttributes,
  'questions' | 'rowsReturned' | 'inputTokens' | 'outputTokens'
>;
