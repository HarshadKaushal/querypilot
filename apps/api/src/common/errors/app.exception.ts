import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@ayd/shared';

export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: number,
  ) {
    super({ code, message }, status);
  }
}

export function dependencyUnavailable(message: string): AppException {
  return new AppException(
    'DEPENDENCY_UNAVAILABLE',
    message,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
