import { z } from 'zod';

/**
 * The model's answer to a question (blueprint 9.4). This schema is sent to the model as the
 * required JSON shape and validates what comes back, so the two cannot drift apart.
 */
export const SqlProposalSchema = z.object({
  status: z
    .enum(['ok', 'ambiguous', 'unanswerable'])
    .describe(
      'ok: the question can be answered from the schema. ambiguous: it could mean several things and the right one cannot be chosen. unanswerable: the schema does not hold the data.',
    ),
  sql: z
    .string()
    .describe(
      'When status is ok: one PostgreSQL SELECT statement that answers the question. Otherwise an empty string.',
    ),
  assumptions: z
    .array(z.string())
    .describe(
      'Short statements of anything assumed to interpret the question. May be empty.',
    ),
  clarifyingQuestion: z
    .string()
    .describe(
      'When status is ambiguous: one question to ask the user. Otherwise an empty string.',
    ),
  explanation: z
    .string()
    .describe(
      'One or two plain sentences: what the query does, or why the question cannot be answered.',
    ),
});

export type SqlProposal = z.infer<typeof SqlProposalSchema>;
