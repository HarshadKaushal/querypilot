import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { errorEnvelope, type ErrorCode } from '@ayd/shared';
import { Logger } from 'nestjs-pino';
import type { Request, Response } from 'express';
import {
  AppException,
  INTERNAL_ERROR_MESSAGE,
  INVALID_REQUEST_MESSAGE,
  NOT_FOUND_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
} from '../errors/app.exception';
import { safeErrorDetail } from '../logging/safe-error';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(Logger) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();
    const requestId = typeof request.id === 'string' ? request.id : 'unknown';

    const mapped = this.map(exception);
    if (mapped.status >= 500) {
      this.logger.error({ ...safeErrorDetail(exception), requestId }, 'request failed');
    }

    response
      .status(mapped.status)
      .json(errorEnvelope(mapped.code, mapped.message, requestId));
  }

  private map(exception: unknown): { status: number; code: ErrorCode; message: string } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        return {
          status,
          code: 'INTERNAL_ERROR',
          message: INTERNAL_ERROR_MESSAGE,
        };
      }
      if (status === HttpStatus.NOT_FOUND) {
        return {
          status,
          code: 'NOT_FOUND',
          message: NOT_FOUND_MESSAGE,
        };
      }
      if (status === HttpStatus.UNAUTHORIZED) {
        return {
          status,
          code: 'UNAUTHENTICATED',
          message: UNAUTHENTICATED_MESSAGE,
        };
      }
      return {
        status,
        code: 'VALIDATION_ERROR',
        message: INVALID_REQUEST_MESSAGE,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: INTERNAL_ERROR_MESSAGE,
    };
  }
}
