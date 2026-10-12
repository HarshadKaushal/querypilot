import { IncomingMessage, ServerResponse } from 'node:http';
import { REQUEST_ID_HEADER, resolveRequestId } from '@ayd/shared';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_ENV, AppConfigModule } from '../config/app-config.module';
import type { AppEnv } from '../config/env';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          messageKey: 'message',
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-api-key"]',
              'res.headers["set-cookie"]',
              'res.headers.set-cookie',
              'req.body.password',
              'req.body.username',
              '*.password',
              '*.secret',
              '*.token',
            ],
            censor: '[redacted]',
          },
          genReqId: (request: IncomingMessage, response: ServerResponse) => {
            const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);
            response.setHeader(REQUEST_ID_HEADER, requestId);
            return requestId;
          },
          customProps: () => ({ service: 'api' }),
        },
      }),
    }),
  ],
})
export class AppLoggerModule {}
