import { GeminiProvider, type InteractionsClient } from './gemini.provider';
import { LlmError, type LlmJsonRequest } from './llm.types';

const request: LlmJsonRequest = {
  purpose: 'probe',
  system: 'Answer in JSON.',
  prompt: 'Say hello.',
  schema: { type: 'object', properties: { greeting: { type: 'string' } } },
  maxOutputTokens: 256,
};

function client(answer: () => Promise<unknown>) {
  const create = jest.fn(answer);
  return {
    client: { interactions: { create } } as unknown as InteractionsClient,
    create,
  };
}

describe('GeminiProvider', () => {
  it('sends a stateless JSON request with the schema, and returns text and token counts', async () => {
    const { client: fake, create } = client(async () => ({
      status: 'completed',
      output_text: '{"greeting":"hi"}',
      usage: { total_input_tokens: 42, total_output_tokens: 7 },
    }));
    const provider = new GeminiProvider('gemini-3.8-flash', 'key', 15000, fake);
    const controller = new AbortController();
    const response = await provider.generateJson({
      ...request,
      signal: controller.signal,
    });
    expect(response).toMatchObject({
      text: '{"greeting":"hi"}',
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      inputTokens: 42,
      outputTokens: 7,
    });
    expect(create).toHaveBeenCalledWith(
      {
        model: 'gemini-3.8-flash',
        system_instruction: 'Answer in JSON.',
        input: 'Say hello.',
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: request.schema,
        },
        generation_config: {
          temperature: 0,
          max_output_tokens: 256,
          thinking_level: 'low',
        },
        store: false,
      },
      { timeout: 15000, maxRetries: 0, fetchOptions: { signal: controller.signal } },
    );
  });

  it('refuses to call anything without an API key', async () => {
    const provider = new GeminiProvider('gemini-3.8-flash', '', 15000);
    await expect(provider.generateJson(request)).rejects.toMatchObject({
      kind: 'misconfigured',
      message: 'GEMINI_API_KEY is not set.',
    });
  });

  it.each([
    [429, 'rate_limited'],
    [503, 'unavailable'],
    [500, 'unavailable'],
    [401, 'misconfigured'],
    [403, 'misconfigured'],
    [400, 'bad_output'],
    [404, 'bad_output'],
  ])('classifies HTTP %i as %s', async (status, kind) => {
    const { client: fake } = client(async () => {
      throw Object.assign(new Error('provider text that may echo the prompt'), {
        status,
      });
    });
    const failure = await new GeminiProvider('m', 'key', 1000, fake)
      .generateJson(request)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LlmError);
    expect(failure).toMatchObject({ kind, model: 'm' });
    // The provider's own text is never passed on.
    expect((failure as Error).message).not.toContain('echo the prompt');
  });

  it('treats a network error or timeout as unavailable, and an abort as cancelled', async () => {
    const network = client(async () => {
      throw new Error('fetch failed');
    });
    await expect(
      new GeminiProvider('m', 'key', 1000, network.client).generateJson(request),
    ).rejects.toMatchObject({ kind: 'unavailable' });

    const controller = new AbortController();
    const aborted = client(async () => {
      controller.abort();
      throw new Error('The operation was aborted');
    });
    await expect(
      new GeminiProvider('m', 'key', 1000, aborted.client).generateJson({
        ...request,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('treats an unfinished or empty answer as bad output', async () => {
    for (const answer of [
      { status: 'incomplete', output_text: '{"greeting":' },
      { status: 'completed', output_text: '' },
      { status: 'completed' },
      { status: 'budget_exceeded' },
    ]) {
      const { client: fake } = client(async () => answer);
      await expect(
        new GeminiProvider('m', 'key', 1000, fake).generateJson(request),
      ).rejects.toMatchObject({ kind: 'bad_output' });
    }
  });
});
