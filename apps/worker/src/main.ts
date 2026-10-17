import 'reflect-metadata';
import { RedisService } from '@ayd/core';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadEnv } from './config/env';
import { WorkerModule } from './worker.module';

// Entry point of the worker (`npm run dev:worker` starts it). It has no HTTP server: it
// starts a Nest application context, connects to Redis, and lets JobWorker take jobs off the
// queue. It is the only process that opens customer databases or calls the model.

/** Only the environment check's message is printed; any other error could hold a secret. */
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
