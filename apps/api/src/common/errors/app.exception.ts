import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@ayd/shared';

/** Fixed client messages, shared with AllExceptionsFilter so both paths read the same. */
export const NOT_FOUND_MESSAGE = 'That resource was not found.';
export const INVALID_REQUEST_MESSAGE = 'The request was not valid.';
export const UNAUTHENTICATED_MESSAGE = 'Sign in to continue.';
export const INTERNAL_ERROR_MESSAGE = 'Something went wrong. Try again.';

/** An error the client may see: a stable code, a message written here, and a status. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: number,
  ) {
    super({ code, message }, status);
  }
}

/**
 * 404 for anything missing or owned by someone else. The two look the same on purpose,
 * so a caller cannot learn whether another user's id exists.
 */
export function notFound(): AppException {
  return new AppException('NOT_FOUND', NOT_FOUND_MESSAGE, HttpStatus.NOT_FOUND);
}

/** 400 VALIDATION_ERROR, with a more specific message when one helps the caller fix it. */
export function invalidRequest(message = INVALID_REQUEST_MESSAGE): AppException {
  return new AppException('VALIDATION_ERROR', message, HttpStatus.BAD_REQUEST);
}
