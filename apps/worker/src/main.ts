import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import { loadEnv } from './config/env';
import { WorkerModule } from './worker.module';

function startupError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('Invalid environment:')) {
    return error.message;
  }
  return 'Worker failed to start';
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = pino({
    level: env.LOG_LEVEL,
    messageKey: 'message',
    base: { service: 'worker' },
  });
  const app = await NestFactory.createApplicationContext(WorkerModule.register(env), {
    logger: false,
  });
  app.enableShutdownHooks();

  const redis = app.get<{ ping: () => Promise<void> }>('WORKER_REDIS');
  await redis.ping();
  logger.info('worker ready');
}

bootstrap().catch((error: unknown) => {
  console.error(startupError(error));
  process.exit(1);
});
