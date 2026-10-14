import { z } from 'zod';
import { FakeLlmProvider } from '../testing/fake-llm-provider';
import { attemptsOf, jsonSchemaFor, LlmClient } from './llm-client';
import { geminiProviders } from './llm.module';
import { LlmError } from './llm.types';
import { coreTestEnv } from '../testing/test-env';

const Greeting = z.object({ greeting: z.string().min(1) });
const request = {
  purpose: 'probe' as const,
  system: 'Answer in JSON.',
  prompt: 'Say hello.',
  maxOutputTokens: 256,
};

describe('LlmClient', () => {
  it('returns the first model answer that is valid JSON in the right shape', async () => {
    const primary = new FakeLlmProvider('primary', [{ text: '{"greeting":"hi"}' }]);
    const fallback = new FakeLlmProvider('fallback');
    const result = await new LlmClient([primary, fallback]).generateObject(
      request,
      Greeting,
    );
    expect(result.value).toEqual({ greeting: 'hi' });
    expect(result.response.model).toBe('primary');
    expect(result.attempts).toEqual([
      expect.objectContaining({ model: 'primary', outcome: 'ok', inputTokens: 100 }),
    ]);
    expect(fallback.requests).toHaveLength(0);
  });

  it('sends the JSON Schema made from the Zod schema', async () => {
    const primary = new FakeLlmProvider('primary', [{ text: '{"greeting":"hi"}' }]);
    await new LlmClient([primary]).generateObject(request, Greeting);
    expect(primary.requests[0]?.schema).toEqual(jsonSchemaFor(Greeting));
    expect(primary.requests[0]?.schema).not.toHaveProperty('$schema');
    expect(primary.requests[0]?.schema).toMatchObject({
      type: 'object',
      properties: { greeting: { type: 'string' } },
    });
  });

  it.each(['rate_limited', 'unavailable', 'bad_output'] as const)(
    'falls back to the next model when the first is %s',
    async (kind) => {
      const primary = new FakeLlmProvider('primary', [
        { error: new LlmError(kind, 'x', 'primary') },
      ]);
      const fallback = new FakeLlmProvider('fallback', [
        { text: '{"greeting":"hello"}' },
      ]);
      const result = await new LlmClient([primary, fallback]).generateObject(
        request,
        Greeting,
      );
      expect(result.value).toEqual({ greeting: 'hello' });
      expect(result.attempts.map((a) => [a.model, a.outcome])).toEqual([
        ['primary', kind],
        ['fallback', 'ok'],
      ]);
    },
  );

  it('falls back when the answer is not JSON or not in the right shape', async () => {
    for (const text of ['not json', '{"greeting":""}', '{"other":1}', '[]']) {
      const primary = new FakeLlmProvider('primary', [{ text }]);
      const fallback = new FakeLlmProvider('fallback', [{ text: '{"greeting":"ok"}' }]);
      const result = await new LlmClient([primary, fallback]).generateObject(
        request,
        Greeting,
      );
      expect(result.attempts[0]?.outcome).toBe('bad_output');
      expect(result.value).toEqual({ greeting: 'ok' });
    }
  });

  it('stops at a missing or refused key, without trying the fallback', async () => {
    const primary = new FakeLlmProvider('primary', [
      { error: new LlmError('misconfigured', 'GEMINI_API_KEY is not set.', 'primary') },
    ]);
    const fallback = new FakeLlmProvider('fallback', [{ text: '{"greeting":"x"}' }]);
    const failure = await new LlmClient([primary, fallback])
      .generateObject(request, Greeting)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'misconfigured' });
    expect(fallback.requests).toHaveLength(0);
  });

  it('stops when the job is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const primary = new FakeLlmProvider('primary', [{ text: '{"greeting":"x"}' }]);
    await expect(
      new LlmClient([primary]).generateObject(
        { ...request, signal: controller.signal },
        Greeting,
      ),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    expect(primary.requests).toHaveLength(0);
  });

  it('reports the last failure, with every attempt, when all models fail', async () => {
    const primary = new FakeLlmProvider('primary', [
      { error: new LlmError('rate_limited', 'x', 'primary') },
    ]);
    const fallback = new FakeLlmProvider('fallback', [{ text: 'nope' }]);
    const failure = await new LlmClient([primary, fallback])
      .generateObject(request, Greeting)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'bad_output' });
    expect(attemptsOf(failure).map((a) => a.outcome)).toEqual([
      'rate_limited',
      'bad_output',
    ]);
  });

  it('turns an unexpected provider error into unavailable and moves on', async () => {
    const primary = new FakeLlmProvider('primary', [
      () => ({ error: new Error('boom') as LlmError }),
    ]);
    const fallback = new FakeLlmProvider('fallback', [{ text: '{"greeting":"x"}' }]);
    const result = await new LlmClient([primary, fallback]).generateObject(
      request,
      Greeting,
    );
    expect(result.attempts[0]?.outcome).toBe('unavailable');
  });
});

describe('geminiProviders', () => {
  it('builds the primary and then the fallback model from the settings', () => {
    const providers = geminiProviders(coreTestEnv());
    expect(providers.map((p) => p.model)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
    ]);
  });

  it('leaves out an empty or duplicate fallback', () => {
    expect(geminiProviders(coreTestEnv({ LLM_FALLBACK_MODEL: '' }))).toHaveLength(1);
    expect(
      geminiProviders(
        coreTestEnv({
          LLM_PRIMARY_MODEL: 'gemini-3.8-flash',
          LLM_FALLBACK_MODEL: 'gemini-3.8-flash',
        }),
      ),
    ).toHaveLength(1);
  });
});
