import { ConnectionService, invalidRequest, JobQueue } from '@ayd/core';
import { MAX_SQL_LENGTH } from '@ayd/sql-guard';
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { PublicUser } from '../auth/auth.repository';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('v1')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(
    private readonly jobs: JobQueue,
    private readonly connections: ConnectionService,
  ) {}

  /**
   * Queues SQL to run on the connection and answers at once with the job. The worker checks
   * it with the SQL guard and runs it; GET /v1/jobs/:id reports the outcome.
   */
  @Post('connections/:id/queries')
  @HttpCode(202)
  async submitQuery(
    @CurrentUser() user: PublicUser,
    @Param('id') connectionId: string,
    @Body() body: { sql?: unknown } | undefined,
  ) {
    const sql = body?.sql;
    if (typeof sql !== 'string' || sql.trim().length === 0) {
      throw invalidRequest('Send the SQL to run as a non-empty "sql" string.');
    }
    if (sql.length > MAX_SQL_LENGTH) {
      throw invalidRequest(`The SQL is longer than ${MAX_SQL_LENGTH} characters.`);
    }
    // NOT_FOUND now, rather than a queued job that fails, for a connection that is not yours.
    await this.connections.get(user.id, connectionId);
    return this.jobs.add('query.run', { userId: user.id, connectionId, sql });
  }

  /** A job's state, and its result or error once finished. Only the owner can read it. */
  @Get('jobs/:id')
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.jobs.get(id, user.id);
  }
}
