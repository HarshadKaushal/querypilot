import 'reflect-metadata';
import { RedisService } from '@ayd/core';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
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
  const app = await NestFactory.createApplicationContext(WorkerModule.register(env), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  await app.get(RedisService).ping();
  logger.log('worker ready');
}

bootstrap().catch((error: unknown) => {
  console.error(startupError(error));
  process.exit(1);
});
