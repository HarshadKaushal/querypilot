import { createLoggerModule } from '@ayd/core';
import { REQUEST_ID_HEADER, resolveRequestId } from '@ayd/shared';
import { Module } from '@nestjs/common';

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
