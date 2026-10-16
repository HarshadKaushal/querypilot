import {
  ConnectionService,
  JobQueue,
  notFound,
  QUERY_HISTORY,
  type QueryHistory,
} from '@ayd/core';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard, type PublicUser, CurrentUser } from '../auth';
import { ApiErrors } from '../common/openapi';
import { requestMeta } from '../common/request-meta';
import { JobViewDto } from '../jobs/jobs.responses';
import { SubmissionLimits } from '../limits/submission-limits';
import { HistoryEntryDto, HistoryPageDto } from './history.responses';

const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;

/**
 * The signed-in user's past questions and SQL (blueprint 8.4): what was asked, the SQL that
 * ran, the outcome, and the cost. Never result rows: re-run to see rows again.
 */
@ApiTags('history')
@ApiBearerAuth()
@ApiErrors(401)
@Controller('v1/history')
@UseGuards(AuthGuard)
export class HistoryController {
  constructor(
    @Inject(QUERY_HISTORY) private readonly history: QueryHistory,
    private readonly jobs: JobQueue,
    private readonly connections: ConnectionService,
    private readonly limits: SubmissionLimits,
  ) {}

  /** Newest first. Pass the returned nextCursor as `cursor` for the next page. */
  @Get()
  @ApiOperation({ summary: 'Your past questions and SQL, newest first (no result rows)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE, default: DEFAULT_PAGE },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'The nextCursor from the previous page.',
  })
  @ApiResponse({ status: 200, description: 'One page of entries.', type: HistoryPageDto })
  list(
    @CurrentUser() user: PublicUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsed = Number(limit ?? DEFAULT_PAGE);
    const size = Number.isInteger(parsed)
      ? Math.min(Math.max(parsed, 1), MAX_PAGE)
      : DEFAULT_PAGE;
    return this.history.list(user.id, size, cursor || undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One history entry' })
  @ApiResponse({ status: 200, description: 'The entry.', type: HistoryEntryDto })
  @ApiErrors(404)
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.history.get(user.id, id);
  }

  /**
   * Runs the entry's stored SQL again as a new job: fresh rows, no model call. The worker
   * checks it with the guard again, so a schema change since then is caught.
   */
  @Post(':id/rerun')
  @ApiOperation({
    summary: "Run an entry's SQL again (queued, no model call)",
    description: 'Answers 404 when nothing ran for that entry.',
  })
  @ApiResponse({
    status: 202,
    description: 'The queued query.run job.',
    type: JobViewDto,
  })
  @ApiErrors(404, 429)
  @HttpCode(202)
  async rerun(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    const entry = await this.history.get(user.id, id);
    if (!entry.sql) {
      // Nothing ran (ambiguous, unanswerable, or failed before SQL): nothing to replay.
      throw notFound();
    }
    await this.connections.get(user.id, entry.connectionId);
    await this.limits.checkRate(user.id);
    return this.jobs.add('query.run', {
      userId: user.id,
      connectionId: entry.connectionId,
      sql: entry.sql,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete one history entry' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiErrors(404)
  @HttpCode(204)
  async delete(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<void> {
    // The delete and its audit row commit together (ADR 0013).
    if (!(await this.history.delete(user.id, id, requestMeta(request).ip))) {
      throw notFound();
    }
  }

  @Delete()
  @ApiOperation({ summary: 'Delete all of your history' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @HttpCode(204)
  async deleteAll(
    @CurrentUser() user: PublicUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.history.deleteAll(user.id, requestMeta(request).ip);
  }
}
