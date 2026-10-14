import { GoogleGenAI } from '@google/genai';
import {
  LlmError,
  type LlmFailureKind,
  type LlmJsonRequest,
  type LlmProvider,
  type LlmResponse,
} from './llm.types';

/** The part of the SDK client this provider uses, so tests can stand in for it. */
export interface InteractionsClient {
  interactions: {
    create(
      params: Record<string, unknown>,
      options?: {
        timeout?: number;
        maxRetries?: number;
        fetchOptions?: { signal?: AbortSignal };
      },
    ): Promise<{
      status?: string;
      output_text?: string;
      usage?: { total_input_tokens?: number; total_output_tokens?: number };
    }>;
  };
}

/**
 * Gemini through the Interactions API (Google's recommended API for new projects), asking
 * for JSON that follows a schema. Interactions are not stored on Google's side, and the
 * SDK does not retry: the client's fallback chain decides what to try next.
 */
export class GeminiProvider implements LlmProvider {
  readonly provider = 'gemini';
  private readonly client: InteractionsClient | null;

  constructor(
    readonly model: string,
    apiKey: string,
    private readonly timeoutMs: number,
    client?: InteractionsClient,
  ) {
    this.client =
      client ??
      (apiKey ? (new GoogleGenAI({ apiKey }) as unknown as InteractionsClient) : null);
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmResponse> {
    if (!this.client) {
      throw new LlmError('misconfigured', 'GEMINI_API_KEY is not set.', this.model);
    }
    const started = Date.now();
    // The SDK's own timeout let a call run 113 s against a 30 s setting, so the deadline is
    // enforced here: the call is aborted and no longer awaited, and the client's fallback
    // chain tries the next model. A job cancellation still aborts it too.
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, deadline])
      : deadline;
    let interaction: Awaited<ReturnType<InteractionsClient['interactions']['create']>>;
    try {
      const call = this.client.interactions.create(
        {
          model: this.model,
          system_instruction: request.system,
          input: request.prompt,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: request.schema,
          },
          generation_config: {
            // Deterministic SQL: the same question over the same schema gives the same answer.
            temperature: 0,
            max_output_tokens: request.maxOutputTokens,
            thinking_level: 'low',
          },
          store: false,
        },
        {
          timeout: this.timeoutMs,
          maxRetries: 0,
          fetchOptions: { signal },
        },
      );
      interaction = await Promise.race([call, rejectWhenAborted(signal)]);
    } catch (error) {
      throw new LlmError(
        classify(error, request.signal),
        describe(error, request.signal),
        this.model,
      );
    }
    const text = interaction.output_text;
    if (
      interaction.status !== 'completed' ||
      typeof text !== 'string' ||
      text.length === 0
    ) {
      throw new LlmError(
        'bad_output',
        `The model did not finish its answer (status ${String(interaction.status).slice(0, 30)}).`,
        this.model,
      );
    }
    return {
      text,
      provider: this.provider,
      model: this.model,
      inputTokens: interaction.usage?.total_input_tokens ?? 0,
      outputTokens: interaction.usage?.total_output_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}

/** Rejects once the signal aborts, so a call the SDK keeps waiting on is not awaited. */
function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) {
      fail();
    } else {
      signal.addEventListener('abort', fail, { once: true });
    }
  });
}

/** The HTTP status on an SDK error, wherever the SDK put it. */
function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  for (const key of ['status', 'statusCode', 'code']) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === 'number' && value >= 100 && value < 600) {
      return value;
    }
  }
  return undefined;
}

function classify(error: unknown, signal: AbortSignal | undefined): LlmFailureKind {
  if (signal?.aborted) {
    return 'cancelled';
  }
  const status = httpStatus(error);
  if (status === 429) {
    return 'rate_limited';
  }
  if (status === 401 || status === 403) {
    return 'misconfigured';
  }
  if (status === 400 || status === 404) {
    // A request this model rejects (an unknown model name, a schema it cannot follow);
    // another model may accept it.
    return 'bad_output';
  }
  // 5xx, timeouts, and network failures.
  return 'unavailable';
}

/** A fixed sentence per kind: provider error text can echo the request, so it is not kept. */
function describe(error: unknown, signal: AbortSignal | undefined): string {
  const kind = classify(error, signal);
  const status = httpStatus(error);
  const suffix = status ? ` (HTTP ${status})` : '';
  switch (kind) {
    case 'cancelled':
      return 'The model call was cancelled.';
    case 'rate_limited':
      return `The model's rate limit was reached${suffix}.`;
    case 'misconfigured':
      return `The model API key was refused${suffix}.`;
    case 'bad_output':
      return `The model rejected the request${suffix}.`;
    default:
      return `The model service did not answer${suffix}.`;
  }
}
