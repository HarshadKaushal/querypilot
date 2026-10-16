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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard, type PublicUser, CurrentUser } from '../auth';
import { ApiErrors } from '../common/openapi';
import { SubmissionLimits } from '../limits/submission-limits';
import { JOB_STREAM_TIMING, streamJob, type JobStreamTiming } from './job-stream';

/** A question is a sentence or two; this leaves room without inviting pasted documents. */
export const MAX_QUESTION_LENGTH = 2000;

/** Lets tests shorten the stream's intervals. */
export const JOB_STREAM_TIMING_TOKEN = Symbol('JOB_STREAM_TIMING');

@ApiTags('questions and jobs')
@ApiBearerAuth()
@ApiErrors(401)
@Controller('v1')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(
    private readonly jobs: JobQueue,
    private readonly events: JobEvents,
    private readonly connections: ConnectionService,
    private readonly limits: SubmissionLimits,
    @Optional()
    @Inject(JOB_STREAM_TIMING_TOKEN)
    private readonly timing: JobStreamTiming = JOB_STREAM_TIMING,
  ) {}

  /**
   * Queues SQL to run on the connection and answers at once with the job. The worker checks
   * it with the SQL guard and runs it; GET /v1/jobs/:id reports the outcome.
   */
  @Post('connections/:id/queries')
  @ApiOperation({
    summary: 'Run your own SQL (queued)',
    description:
      'The worker checks the SQL with the SQL guard against the allowlist, then runs it read-only.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['sql'],
      properties: { sql: { type: 'string', maxLength: MAX_SQL_LENGTH } },
      example: { sql: 'SELECT count(*) FROM orders' },
    },
  })
  @ApiResponse({ status: 202, description: 'The queued query.run job.' })
  @ApiErrors(400, 404, 429)
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
    await this.limits.checkRate(user.id);
    return this.jobs.add('query.run', { userId: user.id, connectionId, sql });
  }

  /**
   * Queues a question in English and answers at once with the job. The worker asks the
   * model for SQL over the allowlisted schema, checks it with the guard, and runs it; an
   * ambiguous or unanswerable question stops before anything runs.
   */
  @Post('connections/:id/questions')
  @ApiOperation({
    summary: 'Ask a question in English (queued)',
    description:
      'The worker asks the model for SQL, checks it with the guard, runs it, and adds a chart and a summary. Counts against the daily question quota.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['question'],
      properties: { question: { type: 'string', maxLength: MAX_QUESTION_LENGTH } },
      example: { question: 'How many orders were placed each month?' },
    },
  })
  @ApiResponse({ status: 202, description: 'The queued question.ask job.' })
  @ApiErrors(400, 404, 429)
  @HttpCode(202)
  async ask(
    @CurrentUser() user: PublicUser,
    @Param('id') connectionId: string,
    @Body() body: { question?: unknown } | undefined,
  ) {
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (question.length === 0) {
      throw invalidRequest('Send the question as a non-empty "question" string.');
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      throw invalidRequest(
        `The question is longer than ${MAX_QUESTION_LENGTH} characters.`,
      );
    }
    await this.connections.get(user.id, connectionId);
    await this.limits.checkRate(user.id);
    await this.limits.takeQuestion(user.id);
    try {
      return await this.jobs.add('question.ask', {
        userId: user.id,
        connectionId,
        question,
      });
    } catch (error) {
      // Not queued (too many jobs, or Redis failed): the question does not count.
      await this.limits.giveBackQuestion(user.id).catch(() => undefined);
      throw error;
    }
  }

  /** A job's state, and its result or error once finished. Only the owner can read it. */
  @Get('jobs/:id')
  @ApiOperation({ summary: "A job's state, and its result or error once finished" })
  @ApiResponse({ status: 200, description: 'The job.' })
  @ApiErrors(404)
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.jobs.get(id, user.id);
  }

  /**
   * Server-Sent Events for one job: a `job` event with the full view on every change, until
   * it finishes. Authenticate with the Authorization header (fetch-based SSE); a token in
   * the URL would end up in logs, so the browser's EventSource cannot be used.
   */
  @Get('jobs/:id/events')
  @ApiOperation({
    summary: 'Live updates for a job (Server-Sent Events)',
    description:
      'A `job` event with the full job on every change, until it finishes. Swagger UI waits for the stream to end, so use `GET /v1/jobs/{id}` here instead.',
  })
  @ApiProduces('text/event-stream')
  @ApiResponse({ status: 200, description: 'An event stream.' })
  @ApiErrors(404)
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
  @ApiOperation({ summary: 'Ask the worker to stop a job' })
  @ApiResponse({
    status: 202,
    description: 'Cancel requested: the job, marked cancelRequested.',
  })
  @ApiResponse({ status: 200, description: 'Already finished: the job, unchanged.' })
  @ApiErrors(404)
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
