import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser, type PublicUser } from '../auth';
import { ApiErrors } from '../common/openapi';
import { requestMeta } from '../common/request-meta';
import { ConnectionService, JobQueue } from '@ayd/core';
import { JobViewDto } from '../jobs/jobs.responses';
import { CreateConnectionDto, UpdateConnectionDto } from './connection.dto';
import { ConnectionDto } from './connection.responses';

@ApiTags('connections')
@ApiBearerAuth()
@ApiErrors(401)
@Controller('v1/connections')
@UseGuards(AuthGuard)
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionService,
    private readonly jobs: JobQueue,
  ) {}

  /**
   * Validates the input (400 when it is bad), seals the credentials, and queues the
   * worker's read-only check. The connection is saved only if the check passes; the job's
   * result is the saved connection.
   */
  @Post()
  @ApiOperation({
    summary: 'Add a database connection',
    description:
      'Queues a read-only check. The connection is saved only if the check passes; follow the returned job with `GET /v1/jobs/{id}`.',
  })
  @ApiResponse({
    status: 202,
    description: 'The queued connection.create job.',
    type: JobViewDto,
  })
  @ApiErrors(400, 429)
  @HttpCode(202)
  create(
    @CurrentUser() user: PublicUser,
    @Req() request: Request,
    @Body() body: CreateConnectionDto,
  ) {
    return this.jobs.add('connection.create', {
      userId: user.id,
      ip: requestMeta(request).ip,
      pending: this.connections.prepareCreate({
        ...body,
        sendSampleRowsToLlm: body.sendSampleRowsToLlm ?? false,
      }),
    });
  }

  @Get()
  @ApiOperation({ summary: 'List your connections (never the login or password)' })
  @ApiResponse({ status: 200, description: 'Your connections.', type: [ConnectionDto] })
  list(@CurrentUser() user: PublicUser) {
    return this.connections.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one connection' })
  @ApiResponse({ status: 200, description: 'The connection.', type: ConnectionDto })
  @ApiErrors(404)
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.connections.get(user.id, id);
  }

  /** Queues a fresh read-only check of a saved connection. */
  @Post(':id/test')
  @ApiOperation({ summary: 'Check a saved connection again (queued)' })
  @ApiResponse({
    status: 202,
    description: 'The queued connection.test job.',
    type: JobViewDto,
  })
  @ApiErrors(404, 429)
  @HttpCode(202)
  async test(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    await this.connections.get(user.id, id);
    return this.jobs.add('connection.test', {
      userId: user.id,
      connectionId: id,
      ip: requestMeta(request).ip,
    });
  }

  /**
   * A new label or sample-rows setting is saved at once: 200 with the connection. A new
   * host, port, database, login, or SSL mode is checked by the worker first: 202 with the
   * job, and the change is saved only if the check passes.
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Change a connection',
    description:
      'Send only the fields to change. A new label or sample-rows setting is saved at once (200). A new host, port, database, login, or SSL mode is checked first (202 with a job).',
  })
  @ApiResponse({
    status: 200,
    description: 'Saved at once: the connection.',
    type: ConnectionDto,
  })
  @ApiResponse({
    status: 202,
    description: 'Checked first: the connection.update job.',
    type: JobViewDto,
  })
  @ApiErrors(400, 404, 429)
  async update(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: UpdateConnectionDto,
  ) {
    const ip = requestMeta(request).ip;
    const plan = await this.connections.prepareUpdate(user.id, id, body, ip);
    if (!plan.check) {
      return plan.connection;
    }
    response.status(202);
    return this.jobs.add('connection.update', {
      userId: user.id,
      connectionId: id,
      ip,
      pending: plan.pending,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a connection, its schema, and its allowlist' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiErrors(404)
  @HttpCode(204)
  async delete(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.connections.delete(user.id, id, requestMeta(request).ip);
  }
}
