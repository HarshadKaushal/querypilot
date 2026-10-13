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
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { PublicUser } from '../auth/auth.repository';
import { requestMeta } from '../auth/cookies';
import { type ConnectionInput, ConnectionService, JobQueue } from '@ayd/core';

interface ConnectionBody {
  label?: unknown;
  host?: unknown;
  port?: unknown;
  databaseName?: unknown;
  username?: unknown;
  password?: unknown;
  sslMode?: unknown;
  sendSampleRowsToLlm?: unknown;
}

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
  @HttpCode(202)
  create(
    @CurrentUser() user: PublicUser,
    @Req() request: Request,
    @Body() body: ConnectionBody,
  ) {
    return this.jobs.add('connection.create', {
      userId: user.id,
      ip: requestMeta(request).ip,
      pending: this.connections.prepareCreate(readCreate(body)),
    });
  }

  @Get()
  list(@CurrentUser() user: PublicUser) {
    return this.connections.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.connections.get(user.id, id);
  }

  /** Queues a fresh read-only check of a saved connection. */
  @Post(':id/test')
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
  async update(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: ConnectionBody,
  ) {
    const ip = requestMeta(request).ip;
    const plan = await this.connections.prepareUpdate(user.id, id, readPatch(body), ip);
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
  @HttpCode(204)
  async delete(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.connections.delete(user.id, id, requestMeta(request).ip);
  }
}

function readCreate(body: ConnectionBody): ConnectionInput {
  return {
    label: typeof body?.label === 'string' ? body.label : '',
    host: typeof body?.host === 'string' ? body.host : '',
    port: typeof body?.port === 'number' ? body.port : Number.NaN,
    databaseName: typeof body?.databaseName === 'string' ? body.databaseName : '',
    username: typeof body?.username === 'string' ? body.username : '',
    password: typeof body?.password === 'string' ? body.password : '',
    sslMode: typeof body?.sslMode === 'string' ? body.sslMode : '',
    sendSampleRowsToLlm: body?.sendSampleRowsToLlm === true,
  };
}

function readPatch(body: ConnectionBody): Partial<ConnectionInput> {
  const patch: Partial<ConnectionInput> = {};
  if (typeof body?.label === 'string') patch.label = body.label;
  if (typeof body?.host === 'string') patch.host = body.host;
  if (typeof body?.port === 'number') patch.port = body.port;
  if (typeof body?.databaseName === 'string') patch.databaseName = body.databaseName;
  if (typeof body?.username === 'string') patch.username = body.username;
  if (typeof body?.password === 'string') patch.password = body.password;
  if (typeof body?.sslMode === 'string') patch.sslMode = body.sslMode;
  if (typeof body?.sendSampleRowsToLlm === 'boolean') {
    patch.sendSampleRowsToLlm = body.sendSampleRowsToLlm;
  }
  return patch;
}
