/** What a history entry came from (queries.kind): an English question, or SQL the user typed. */
export const QueryKind = {
  Question: 'question',
  Sql: 'sql',
} as const;

export type QueryKind = (typeof QueryKind)[keyof typeof QueryKind];
