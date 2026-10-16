/** How a history entry ended (queries.status). */
export const QueryStatus = {
  Answered: 'answered',
  Ambiguous: 'ambiguous',
  Unanswerable: 'unanswerable',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;

export type QueryStatus = (typeof QueryStatus)[keyof typeof QueryStatus];
