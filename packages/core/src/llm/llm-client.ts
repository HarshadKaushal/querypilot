import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import {
  LlmError,
  type LlmAttempt,
  type LlmJsonRequest,
  type LlmProvider,
  type LlmResponse,
} from './llm.types';

/** The providers to try, in order: the primary model, then the fallback. */
export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');

/** The providers for summaries: a lighter, faster model first, then the main chain. */
export const LLM_SUMMARY_PROVIDERS = Symbol('LLM_SUMMARY_PROVIDERS');

export interface LlmResult<T> {
  value: T;
  /** The call that produced the value. */
  response: LlmResponse;
  /** Every provider tried, failures included, in order. */
  attempts: LlmAttempt[];
}

/** A request whose answer shape is given as a Zod schema instead of raw JSON Schema. */
export type LlmObjectRequest = Omit<LlmJsonRequest, 'schema'>;

/**
 * Asks the models in order for a JSON answer and validates it. The Zod schema is the one
 * definition of the answer: it becomes the JSON Schema sent to the model and checks what
 * comes back. A rate limit, an outage, or an answer that is not valid JSON in that shape
 * moves on to the next model. A missing or refused key, or a cancelled job, stops at once,
 * because the next model would fail the same way.
 */
@Injectable()
export class LlmClient {
  constructor(
    @Inject(LLM_PROVIDERS) private readonly providers: LlmProvider[],
    // Without a summary list, summaries use the main chain.
    @Optional()
    @Inject(LLM_SUMMARY_PROVIDERS)
    private readonly summaryProviders?: LlmProvider[],
  ) {}

  async generateObject<T>(
    request: LlmObjectRequest,
    shape: z.ZodType<T>,
  ): Promise<LlmResult<T>> {
    const schema = jsonSchemaFor(shape);
    const attempts: LlmAttempt[] = [];
    let last = new LlmError('misconfigured', 'No model is configured.');
    const providers =
      request.purpose === 'summary' && this.summaryProviders?.length
        ? this.summaryProviders
        : this.providers;
    for (const provider of providers) {
      if (request.signal?.aborted) {
        last = new LlmError('cancelled', 'The model call was cancelled.', provider.model);
        break;
      }
      const started = Date.now();
      let response: LlmResponse;
      try {
        response = await provider.generateJson({ ...request, schema });
      } catch (error) {
        last =
          error instanceof LlmError
            ? error
            : new LlmError('unavailable', 'The model call failed.', provider.model);
        attempts.push(attempt(provider, last.kind, Date.now() - started));
        if (last.kind === 'misconfigured' || last.kind === 'cancelled') {
          break;
        }
        continue;
      }
      const parsed = shape.safeParse(parseJson(response.text));
      if (!parsed.success) {
        last = new LlmError(
          'bad_output',
          'The model answered in the wrong shape.',
          provider.model,
        );
        attempts.push({
          ...attempt(provider, 'bad_output', response.latencyMs),
          ...tokens(response),
        });
        continue;
      }
      attempts.push({
        ...attempt(provider, 'ok', response.latencyMs),
        ...tokens(response),
      });
      return { value: parsed.data, response, attempts };
    }
    throw Object.assign(last, { attempts });
  }
}

/** The attempts made before a chain failed, for accounting. Empty for other errors. */
export function attemptsOf(error: unknown): LlmAttempt[] {
  const attempts = (error as { attempts?: unknown } | null)?.attempts;
  return Array.isArray(attempts) ? (attempts as LlmAttempt[]) : [];
}

function attempt(
  provider: LlmProvider,
  outcome: LlmAttempt['outcome'],
  latencyMs: number,
): LlmAttempt {
  return {
    provider: provider.provider,
    model: provider.model,
    outcome,
    latencyMs,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function tokens(response: LlmResponse): Pick<LlmAttempt, 'inputTokens' | 'outputTokens'> {
  return { inputTokens: response.inputTokens, outputTokens: response.outputTokens };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The JSON Schema for a Zod schema, without the `$schema` marker models do not expect. */
export function jsonSchemaFor(shape: z.ZodType): Record<string, unknown> {
  const { $schema: _marker, ...schema } = z.toJSONSchema(shape) as Record<
    string,
    unknown
  >;
  return schema;
}
