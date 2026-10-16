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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser, type PublicUser } from '../auth';
import { ApiErrors } from '../common/openapi';
import { requestMeta } from '../common/request-meta';
import { type ConnectionInput, ConnectionService, JobQueue } from '@ayd/core';

/** For the API docs: a connection to the sample database from `npm run up:deps`. */
const CONNECTION_EXAMPLE = {
  label: 'Sample shop',
  host: '127.0.0.1',
  port: 5433,
  databaseName: 'sample',
  username: 'sample_ro',
  password: 'sample_ro_password',
  sslMode: 'require',
  sendSampleRowsToLlm: false,
};

const CONNECTION_FIELDS = {
  label: { type: 'string' },
  host: { type: 'string' },
  port: { type: 'integer' },
  databaseName: { type: 'string' },
  username: { type: 'string', description: 'A read-only login.' },
  password: { type: 'string', description: 'Encrypted at rest, never returned.' },
  sslMode: {
    type: 'string',
    enum: ['require', 'verify-full'],
    description: 'Plaintext modes are refused (SSL_REQUIRED).',
  },
  sendSampleRowsToLlm: { type: 'boolean' },
};

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
  @ApiBody({
    schema: {
      type: 'object',
      required: Object.keys(CONNECTION_EXAMPLE),
      properties: CONNECTION_FIELDS,
      example: CONNECTION_EXAMPLE,
    },
  })
  @ApiResponse({ status: 202, description: 'The queued connection.create job.' })
  @ApiErrors(400, 429)
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
  @ApiOperation({ summary: 'List your connections (never the login or password)' })
  @ApiResponse({ status: 200, description: 'Your connections.' })
  list(@CurrentUser() user: PublicUser) {
    return this.connections.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one connection' })
  @ApiResponse({ status: 200, description: 'The connection.' })
  @ApiErrors(404)
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.connections.get(user.id, id);
  }

  /** Queues a fresh read-only check of a saved connection. */
  @Post(':id/test')
  @ApiOperation({ summary: 'Check a saved connection again (queued)' })
  @ApiResponse({ status: 202, description: 'The queued connection.test job.' })
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
  @ApiBody({
    schema: {
      type: 'object',
      properties: CONNECTION_FIELDS,
      example: { label: 'Sample shop (renamed)' },
    },
  })
  @ApiResponse({ status: 200, description: 'Saved at once: the connection.' })
  @ApiResponse({ status: 202, description: 'Checked first: the connection.update job.' })
  @ApiErrors(400, 404, 429)
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
