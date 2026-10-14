import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_ENV, type CoreEnv } from '../config/env';

/** Log paths that never reach the output, in either process. */
export const REDACTED_PATHS = [
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
  '*.apiKey',
];

/**
 * JSON logging through pino, with the same level, message key, and redaction in the API
 * and the worker. Every line carries `service`, startup and job logs included, not only
 * request logs. genReqId is for HTTP apps.
 */
export function createLoggerModule(options: {
  service: string;
  genReqId?: (request: IncomingMessage, response: ServerResponse) => string;
}): DynamicModule {
  return LoggerModule.forRootAsync({
    inject: [APP_ENV],
    useFactory: (env: CoreEnv) => ({
      pinoHttp: {
        level: env.LOG_LEVEL,
        base: { pid: process.pid, hostname: hostname(), service: options.service },
        messageKey: 'message',
        redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
        ...(options.genReqId ? { genReqId: options.genReqId } : {}),
      },
    }),
  });
}
