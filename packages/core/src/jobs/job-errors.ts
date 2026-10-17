import type { AppException } from '../errors/app.exception';
import type { LlmError } from '../llm/llm.types';
import type { ExecutionFailure } from '../user-database/query-error';
import type { JobError } from './job.types';

// The three kinds of expected failure a job can hit, each turned into the JobError its owner
// sees. Every message is written in this codebase: an AppException's was written to be
// shown, and a model's or a database's own text is never passed on.

/** An AppException carries a stable code and a message written here, so both pass through. */
export function fromException(error: AppException): JobError {
  const body = error.getResponse() as { message: string };
  return { code: error.code, message: body.message, retryable: false };
}

/** A model failure as the owner sees it. The provider's own text is never included. */
export function llmFailure(error: LlmError): JobError {
  if (error.kind === 'misconfigured') {
    return {
      code: 'LLM_NOT_CONFIGURED',
      message:
        'The assistant is not set up on this server yet. An administrator needs to add a model API key.',
      retryable: false,
    };
  }
  return {
    code: 'LLM_UNAVAILABLE',
    message:
      error.kind === 'rate_limited'
        ? 'The assistant is busy right now. Try again in a minute.'
        : 'The assistant could not answer right now. Try again shortly.',
    retryable: true,
  };
}

/** A query the executor could not run. Its message was already written by query-error.ts. */
export function executionFailure(failure: ExecutionFailure): JobError {
  return { code: failure.code, message: failure.message, retryable: failure.retryable };
}
