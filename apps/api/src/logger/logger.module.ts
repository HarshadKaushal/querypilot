import { createLoggerModule } from '@ayd/core';
import { REQUEST_ID_HEADER, resolveRequestId } from '@ayd/shared';
import { Module } from '@nestjs/common';

/**
 * The API's JSON logger. Every request gets a request id: the caller's
 * `x-request-id` header if it is well formed, otherwise a new one. The id is echoed back in
 * the response header and appears in every log line and error body for that request.
 */
@Module({
  imports: [
    createLoggerModule({
      service: 'api',
      genReqId: (request, response) => {
        const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);
        response.setHeader(REQUEST_ID_HEADER, requestId);
        return requestId;
      },
    }),
  ],
})
export class AppLoggerModule {}
