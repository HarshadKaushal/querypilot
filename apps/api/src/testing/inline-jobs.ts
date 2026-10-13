import {
  ConnectionJobRunner,
  JobCancellation,
  JobEvents,
  ConnectionService,
  JobProcessor,
  JobQueue,
  QueryExecutor,
  QueryJobRunner,
  SchemaService,
  SqlGuardService,
} from '@ayd/core';
import { InlineJobQueue } from '@ayd/core/testing';
import type { Provider } from '@nestjs/common';

/**
 * The services and job runners an HTTP test needs, with jobs run at once in process by
 * InlineJobQueue. The test still provides the repositories, the address resolver, and the
 * probe. The executor is a stub unless one is passed.
 */
export function inlineJobProviders(executor: Partial<QueryExecutor> = {}): Provider[] {
  return [
    ConnectionService,
    SchemaService,
    SqlGuardService,
    QueryJobRunner,
    ConnectionJobRunner,
    JobProcessor,
    { provide: JobQueue, useClass: InlineJobQueue },
    // Inline jobs finish before add() returns, so nothing is ever waiting to be cancelled
    // or followed.
    {
      provide: JobCancellation,
      useValue: { requested: async () => false, request: async () => undefined },
    },
    { provide: JobEvents, useValue: { subscribe: async () => () => undefined } },
    {
      provide: QueryExecutor,
      useValue: {
        run: async () => {
          throw new Error('This test runs no queries');
        },
        ...executor,
      },
    },
  ];
}
