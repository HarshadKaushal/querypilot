import type { INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { buildOpenApiDocument, setupApiDocs } from './openapi';

/** Routes anyone may call: sign-in, health checks, and setup help. */
const PUBLIC_TAGS = ['auth', 'health', 'meta'];

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * Every controller AppModule registers, read from Nest's module metadata, so a controller
 * added later is checked too without editing this test.
 */
function controllersOf(entry: unknown, seen = new Set<unknown>()): Type<unknown>[] {
  // A dynamic module ({ module, imports }) or a plain module class.
  const dynamic = entry as { module?: unknown; imports?: unknown[] };
  const target = dynamic?.module ?? entry;
  if (!target || seen.has(target)) {
    return [];
  }
  seen.add(target);
  const imports: unknown[] = [
    ...((Reflect.getMetadata('imports', target as object) as unknown[]) ?? []),
    ...(dynamic.imports ?? []),
  ];
  return [
    ...((Reflect.getMetadata('controllers', target as object) as Type<unknown>[]) ?? []),
    ...imports.flatMap((child) => controllersOf(child, seen)),
  ];
}

/** How many route handlers the controllers declare (Nest stores the HTTP method on each). */
function routeCount(controllers: Type<unknown>[]): number {
  return controllers.reduce((count, controller) => {
    const prototype = controller.prototype as Record<string, unknown>;
    const handlers = Object.getOwnPropertyNames(prototype).filter(
      (name) =>
        typeof prototype[name] === 'function' &&
        Reflect.getMetadata('method', prototype[name] as object) !== undefined,
    );
    return count + handlers.length;
  }, 0);
}

/** Every operation in the document, as "METHOD /path" with its details. */
function operations(document: OpenAPIObject): [string, OperationObject][] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    METHODS.filter((method) => item[method]).map((method): [string, OperationObject] => [
      `${method.toUpperCase()} ${path}`,
      item[method] as OperationObject,
    ]),
  );
}

describe('API docs (OpenAPI)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    // The docs only read route metadata, so every service is an empty stand-in.
    const moduleRef = await Test.createTestingModule({
      controllers: controllersOf(AppModule),
    })
      .useMocker(() => ({}))
      .compile();
    app = moduleRef.createNestApplication();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists every route, each with a summary and a tag', () => {
    const document = buildOpenApiDocument(app);
    const ops = operations(document);
    expect(ops.length).toBe(routeCount(controllersOf(AppModule)));
    const undocumented = ops
      .filter(([, op]) => !op.summary || !op.tags?.length)
      .map(([name]) => name);
    expect(undocumented).toEqual([]);
  });

  it('asks for the bearer token on every route except the public ones', () => {
    const document = buildOpenApiDocument(app);
    const wrong = operations(document)
      .filter(([, op]) => {
        const isPublic = op.tags?.some((tag) => PUBLIC_TAGS.includes(tag)) ?? false;
        const bearer = op.security?.some((scheme) => 'bearer' in scheme) ?? false;
        return isPublic === bearer;
      })
      .map(([name]) => name);
    expect(wrong).toEqual([]);
  });

  it('describes failures with the shared error envelope', () => {
    const document = buildOpenApiDocument(app);
    expect(document.components?.schemas?.ErrorEnvelope).toBeDefined();
    const unauthenticated = document.paths['/v1/connections']?.get?.responses['401'];
    expect(unauthenticated).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorEnvelope' },
        },
      },
    });
  });

  it('describes every request body with a DTO class, not a hand-written schema', () => {
    const document = buildOpenApiDocument(app);
    const inline = operations(document)
      .filter(([, op]) => op.requestBody)
      .filter(([, op]) => {
        const body = op.requestBody as { content?: Record<string, { schema?: object }> };
        const schema = body.content?.['application/json']?.schema;
        return !(schema && '$ref' in schema);
      })
      .map(([name]) => name);
    expect(inline).toEqual([]);
  });

  it('shows the question DTO with its example and limit', () => {
    const document = buildOpenApiDocument(app);
    expect(
      document.paths['/v1/connections/{id}/questions']?.post?.requestBody,
    ).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/AskQuestionDto' } },
      },
    });
    expect(document.components?.schemas?.AskQuestionDto).toMatchObject({
      required: ['question'],
      properties: {
        question: { type: 'string', maxLength: 2000, example: expect.any(String) },
      },
    });
  });

  it('serves Swagger UI and the JSON document outside production', async () => {
    expect(setupApiDocs(app, { NODE_ENV: 'development' })).toBe(true);
    await app.init();
    const server = app.getHttpServer();

    const json = await request(server).get('/docs/openapi.json');
    expect(json.status).toBe(200);
    expect(json.body.openapi).toMatch(/^3\./);
    expect(json.body.paths['/v1/auth/dev/login']).toBeDefined();

    const page = await request(server).get('/docs');
    expect(page.status).toBe(200);
    expect(page.text).toContain('swagger-ui');
  });

  it('does not serve the docs in production', async () => {
    expect(setupApiDocs(app, { NODE_ENV: 'production' })).toBe(false);
    await app.init();
    const server = app.getHttpServer();

    expect((await request(server).get('/docs/openapi.json')).status).toBe(404);
    expect((await request(server).get('/docs')).status).toBe(404);
  });
});
