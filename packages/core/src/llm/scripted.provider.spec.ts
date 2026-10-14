import { buildPrompt } from '../ask/prompt';
import { SqlProposalSchema } from '../ask/sql-proposal';
import { coreTestEnv } from '../testing/test-env';
import { geminiProviders, geminiSummaryProviders } from './llm.module';
import { ScriptedLlmProvider, scriptedProposal } from './scripted.provider';

describe('scriptedProposal', () => {
  it('answers the browser tests’ questions by fixed rules, in the proposal shape', () => {
    const cases: Array<[string, string]> = [
      ['How many orders does each region have?', 'ok'],
      ['How many orders are there?', 'ok'],
      ['Which customer is best?', 'ambiguous'],
      ['Delete all the orders', 'ok'],
      ['What is the weather?', 'unanswerable'],
    ];
    for (const [question, status] of cases) {
      const proposal = scriptedProposal(question);
      expect(SqlProposalSchema.parse(proposal).status).toBe(status);
    }
    expect(scriptedProposal('Please DROP the table').sql).toBe(
      'DELETE FROM public.orders',
    );
    expect(scriptedProposal('orders by region').sql).toContain('GROUP BY c.region');
  });
});

describe('ScriptedLlmProvider', () => {
  it('reads the question from the real prompt, and writes a summary without numbers', async () => {
    const provider = new ScriptedLlmProvider();
    const prompt = buildPrompt({ question: 'Which customer is best?', tables: [] });
    const proposal = JSON.parse(
      (
        await provider.generateJson({
          purpose: 'sql_proposal',
          system: '',
          prompt,
          schema: {},
          maxOutputTokens: 100,
        })
      ).text,
    );
    expect(proposal.status).toBe('ambiguous');
    const summary = JSON.parse(
      (
        await provider.generateJson({
          purpose: 'summary',
          system: '',
          prompt: '',
          schema: {},
          maxOutputTokens: 100,
        })
      ).text,
    );
    expect(summary.summary).not.toMatch(/\d/);
  });

  it('is used for both chains only when LLM_FAKE is on', () => {
    const fake = coreTestEnv({ LLM_FAKE: 'true' });
    expect(geminiProviders(fake).map((p) => p.provider)).toEqual(['scripted']);
    expect(geminiSummaryProviders(fake).map((p) => p.provider)).toEqual(['scripted']);
    expect(geminiProviders(coreTestEnv()).map((p) => p.provider)).not.toContain(
      'scripted',
    );
  });
});
