import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { APP_ENV } from './config/app-config.module';
import type { AppEnv } from './config/env';

function startupError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('Invalid environment:')) {
    return error.message;
  }
  return 'API failed to start';
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalFilters(app.get(AllExceptionsFilter));
  app.enableShutdownHooks();

  const env = app.get<AppEnv>(APP_ENV);
  await app.listen(env.API_PORT);
  logger.log(`api listening on ${env.API_PORT}`);
}

bootstrap().catch((error: unknown) => {
  console.error(startupError(error));
  process.exit(1);
});
