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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { PublicUser } from '../auth/auth.repository';
import { requestMeta } from '../auth/cookies';
import { ConnectionService, type ConnectionInput } from './connection.service';

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
  constructor(private readonly connections: ConnectionService) {}

  @Post()
  create(
    @CurrentUser() user: PublicUser,
    @Req() request: Request,
    @Body() body: ConnectionBody,
  ) {
    return this.connections.create(user.id, readCreate(body), requestMeta(request).ip);
  }

  @Get()
  list(@CurrentUser() user: PublicUser) {
    return this.connections.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.connections.get(user.id, id);
  }

  @Post(':id/test')
  test(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.connections.test(user.id, id, requestMeta(request).ip);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
    @Body() body: ConnectionBody,
  ) {
    return this.connections.update(user.id, id, readPatch(body), requestMeta(request).ip);
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
