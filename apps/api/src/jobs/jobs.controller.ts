import { ConnectionService, invalidRequest, JobEvents, JobQueue } from '@ayd/core';
import { MAX_SQL_LENGTH } from '@ayd/sql-guard';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { PublicUser } from '../auth/auth.repository';
import { CurrentUser } from '../auth/current-user.decorator';
import { JOB_STREAM_TIMING, streamJob, type JobStreamTiming } from './job-stream';

/** Lets tests shorten the stream's intervals. */
export const JOB_STREAM_TIMING_TOKEN = Symbol('JOB_STREAM_TIMING');

@Controller('v1')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(
    private readonly jobs: JobQueue,
    private readonly events: JobEvents,
    private readonly connections: ConnectionService,
    @Optional()
    @Inject(JOB_STREAM_TIMING_TOKEN)
    private readonly timing: JobStreamTiming = JOB_STREAM_TIMING,
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

  /**
   * Server-Sent Events for one job: a `job` event with the full view on every change, until
   * it finishes. Authenticate with the Authorization header (fetch-based SSE); a token in
   * the URL would end up in logs, so the browser's EventSource cannot be used.
   */
  @Get('jobs/:id/events')
  async stream(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await streamJob(
      { jobs: this.jobs, events: this.events },
      { jobId: id, userId: user.id, request, response },
      this.timing,
    );
  }

  /**
   * Asks the worker to stop the job: 202 with the job marked cancelRequested. A finished
   * job cannot be cancelled and comes back unchanged with 200.
   */
  @Post('jobs/:id/cancel')
  async cancel(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const view = await this.jobs.cancel(id, user.id);
    response.status(view.cancelRequested ? 202 : 200);
    return view;
  }
}
