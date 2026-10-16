import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { DOCS_PATH, setupApiDocs } from './common/openapi';
import { APP_ENV } from './config/app-config.module';
import type { AppEnv } from './config/env';

function startupError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('Invalid environment:')) {
    return error.message;
  }
  return 'API failed to start';
}

async function bootstrap(): Promise<void> {
  // The adapter is passed in rather than left for Nest to find. Nest would look it up from
  // its own install folder, which in this workspace cannot always see the API's packages.
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalFilters(app.get(AllExceptionsFilter));
  app.enableShutdownHooks();

  const env = app.get<AppEnv>(APP_ENV);
  const docs = setupApiDocs(app, env);
  await app.listen(env.API_PORT);
  logger.log(`api listening on ${env.API_PORT}`);
  if (docs) {
    logger.log(`api docs at http://localhost:${env.API_PORT}/${DOCS_PATH}`);
  }
}

bootstrap().catch((error: unknown) => {
  console.error(startupError(error));
  process.exit(1);
});
