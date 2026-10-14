/** One request for a JSON answer that matches `schema`. */
export interface LlmJsonRequest {
  /** What the answer is for, for accounting and logs: never the prompt itself. */
  purpose: 'sql_proposal' | 'summary' | 'probe';
  /** Fixed instructions: role, rules, output contract. */
  system: string;
  /** The question and its context. */
  prompt: string;
  /** JSON Schema the answer must follow. */
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  /** Aborted when the job is cancelled. */
  signal?: AbortSignal;
}

/** What one model call cost and produced. */
export interface LlmResponse {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** A model behind one API. The client tries providers in order. */
export interface LlmProvider {
  readonly provider: string;
  readonly model: string;
  generateJson(request: LlmJsonRequest): Promise<LlmResponse>;
}

/**
 * Why a call failed. rate_limited, unavailable, and bad_output may succeed on another
 * model; misconfigured (no or wrong key) and cancelled would not, so the client stops.
 */
export type LlmFailureKind =
  'rate_limited' | 'unavailable' | 'bad_output' | 'misconfigured' | 'cancelled';

/** A failed model call. The message is written here, never copied from the provider. */
export class LlmError extends Error {
  constructor(
    readonly kind: LlmFailureKind,
    message: string,
    readonly model?: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** One provider tried for a request, for latency and fallback accounting. */
export interface LlmAttempt {
  provider: string;
  model: string;
  outcome: 'ok' | LlmFailureKind;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}
