import { applyDecorators, type INestApplication } from '@nestjs/common';
import {
  ApiResponse,
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
  type SchemaObject,
} from '@nestjs/swagger';
import { ERROR_CODES } from '@ayd/shared';
import { REFRESH_COOKIE } from '../auth/sign-in/cookies';
import type { AppEnv } from '../config/env';

/** Swagger UI is served here, and the raw document at /docs/openapi.json. */
export const DOCS_PATH = 'docs';

const ERROR_ENVELOPE = 'ErrorEnvelope';

/** What every failure looks like (AllExceptionsFilter writes it). */
const ERROR_ENVELOPE_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string', enum: [...ERROR_CODES] },
        message: { type: 'string', description: 'Safe to show to the user.' },
        requestId: {
          type: 'string',
          description: 'Also sent as the x-request-id header.',
        },
      },
    },
  },
  example: {
    error: {
      code: 'NOT_FOUND',
      message: 'That resource was not found.',
      requestId: 'req-01',
    },
  },
};

const COMMON_ERRORS = {
  400: 'The request was not valid (VALIDATION_ERROR).',
  401: 'Not signed in, or the access token expired (UNAUTHENTICATED).',
  404: 'Not found, or owned by another user; the two look the same on purpose (NOT_FOUND).',
  429: 'Too many requests, the daily quota is used up, or too many unfinished jobs (RATE_LIMITED, QUOTA_EXCEEDED, TOO_MANY_JOBS). Wait for the Retry-After header.',
} as const;

/** Documents the usual failures of a route or a whole controller, with the error shape. */
export function ApiErrors(...statuses: (keyof typeof COMMON_ERRORS)[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: COMMON_ERRORS[status],
        schema: { $ref: `#/components/schemas/${ERROR_ENVELOPE}` },
      }),
    ),
  );
}

/** The OpenAPI document for every route the app has registered. */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Ask Your Database API')
    .setDescription(
      [
        'Ask questions in English about your own PostgreSQL database.',
        '',
        '**To try a protected route:** call `POST /v1/auth/dev/login` (development only),',
        'copy `accessToken` from the response, press **Authorize**, and paste it.',
        'Access tokens last 15 minutes; `POST /v1/auth/refresh` gives a new one.',
        '',
        'Questions, SQL, and connection checks run as **jobs**: the route answers 202 with',
        'the job, and `GET /v1/jobs/{id}` reports the result.',
      ].join('\n'),
    )
    .setVersion('1')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'The accessToken from dev login or refresh.',
    })
    .addCookieAuth(REFRESH_COOKIE, {
      type: 'apiKey',
      in: 'cookie',
      description:
        'The HttpOnly refresh cookie, set by sign-in. The browser sends it by itself.',
    })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, [ERROR_ENVELOPE]: ERROR_ENVELOPE_SCHEMA },
  };
  return document;
}

/**
 * Serves Swagger UI at /docs, outside production only: the docs list every route and its
 * inputs, which helps an attacker map the API. Returns whether the docs are served.
 */
export function setupApiDocs(
  app: INestApplication,
  env: Pick<AppEnv, 'NODE_ENV'>,
): boolean {
  if (env.NODE_ENV === 'production') {
    return false;
  }
  SwaggerModule.setup(DOCS_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
    yamlDocumentUrl: `${DOCS_PATH}/openapi.yaml`,
    customSiteTitle: 'Ask Your Database API',
  });
  return true;
}
