import type { SqlProposal } from '../ask/sql-proposal';
import {
  LlmError,
  type LlmJsonRequest,
  type LlmProvider,
  type LlmResponse,
} from './llm.types';

/**
 * The answer the scripted model gives a question, by fixed rules on its words. Browser
 * tests use it so the full pipeline (guard, executor, chart, summary) runs without a real
 * model. The SQL is written for the sample database (infra/sample-db).
 */
export function scriptedProposal(question: string): SqlProposal {
  const asked = question.toLowerCase();
  const none = { assumptions: [], clarifyingQuestion: '' };
  if (/\b(delete|drop)\b/.test(asked)) {
    // A write the SQL guard must refuse: the test proves the guard, not the model, stops it.
    return {
      ...none,
      status: 'ok',
      sql: 'DELETE FROM public.orders',
      explanation: 'Deletes every order.',
    };
  }
  if (asked.includes('best')) {
    return {
      ...none,
      status: 'ambiguous',
      sql: '',
      clarifyingQuestion:
        'Do you mean the customer with the most orders, or the most spent?',
      explanation: '"Best" can be measured more than one way.',
    };
  }
  if (asked.includes('region')) {
    return {
      ...none,
      status: 'ok',
      sql:
        'SELECT c.region, count(o.id) AS orders FROM public.customers AS c ' +
        'JOIN public.orders AS o ON o.customer_id = c.id GROUP BY c.region ORDER BY c.region',
      assumptions: ['Orders of every status are counted.'],
      explanation: 'Counts orders per customer region.',
    };
  }
  if (asked.includes('how many orders')) {
    return {
      ...none,
      status: 'ok',
      sql: 'SELECT count(*) AS orders FROM public.orders',
      explanation: 'Counts all orders.',
    };
  }
  return {
    ...none,
    status: 'unanswerable',
    sql: '',
    explanation: 'The scripted test model only knows a few questions.',
  };
}

/** The question between the prompt's <question> tags (ask/prompt.ts). */
function questionIn(prompt: string): string {
  return /<question>\n?([\s\S]*?)\n?<\/question>/.exec(prompt)?.[1] ?? '';
}

/**
 * A model that answers from fixed rules, for browser tests (LLM_FAKE=true). Refused in
 * production by the settings check, so it can never answer a real user.
 */
export class ScriptedLlmProvider implements LlmProvider {
  readonly provider = 'scripted';
  readonly model = 'scripted-test-model';

  async generateJson(request: LlmJsonRequest): Promise<LlmResponse> {
    if (request.signal?.aborted) {
      throw new LlmError('cancelled', 'The model call was cancelled.', this.model);
    }
    const answer =
      request.purpose === 'sql_proposal'
        ? scriptedProposal(questionIn(request.prompt))
        : request.purpose === 'summary'
          ? // No numbers, so the server's number check keeps it.
            { summary: 'Here is what the data shows for your question.' }
          : { ok: true };
    return {
      text: JSON.stringify(answer),
      provider: this.provider,
      model: this.model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };
  }
}
