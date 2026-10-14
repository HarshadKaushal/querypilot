import {
  LlmError,
  type LlmJsonRequest,
  type LlmProvider,
  type LlmResponse,
} from '../llm/llm.types';

/** One scripted answer: JSON text to return, an error to throw, or a function of the request. */
export type FakeLlmStep =
  | { text: string; inputTokens?: number; outputTokens?: number }
  | { error: LlmError }
  | ((request: LlmJsonRequest) => FakeLlmStep);

/**
 * A model for tests, which must never call a real one. It answers from a script, one step
 * per call, and records every request so a test can check what the model was shown.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly provider = 'fake';
  readonly requests: LlmJsonRequest[] = [];
  private readonly steps: FakeLlmStep[];

  constructor(
    readonly model: string,
    steps: FakeLlmStep[] = [],
  ) {
    this.steps = [...steps];
  }

  /** Adds answers for later calls. */
  script(...steps: FakeLlmStep[]): this {
    this.steps.push(...steps);
    return this;
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmResponse> {
    this.requests.push(request);
    if (request.signal?.aborted) {
      throw new LlmError('cancelled', 'The model call was cancelled.', this.model);
    }
    let step = this.steps.shift();
    if (!step) {
      throw new Error(`FakeLlmProvider ${this.model} has no scripted answer left`);
    }
    if (typeof step === 'function') {
      step = step(request);
    }
    if (typeof step === 'function') {
      throw new Error('A scripted function must return text or an error');
    }
    if ('error' in step) {
      throw step.error;
    }
    return {
      text: step.text,
      provider: this.provider,
      model: this.model,
      inputTokens: step.inputTokens ?? 100,
      outputTokens: step.outputTokens ?? 20,
      latencyMs: 5,
    };
  }
}
