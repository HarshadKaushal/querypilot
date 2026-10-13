import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { PublicUser } from '../auth/auth.repository';
import { requestMeta } from '../auth/cookies';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConnectionService, JobQueue, SchemaService } from '@ayd/core';

@Controller('v1/connections/:id')
@UseGuards(AuthGuard)
export class SchemaController {
  constructor(
    private readonly schemas: SchemaService,
    private readonly connections: ConnectionService,
    private readonly jobs: JobQueue,
  ) {}

  /** Queues a read of the database's schema. The job's result is the refresh summary. */
  @Post('schema/refresh')
  @HttpCode(202)
  async refresh(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    await this.connections.get(user.id, id);
    return this.jobs.add('schema.refresh', {
      userId: user.id,
      connectionId: id,
      ip: requestMeta(request).ip,
    });
  }

  @Get('schema')
  schema(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.schemas.schema(user.id, id);
  }

  @Get('allowlist')
  allowlist(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.schemas.allowlist(user.id, id);
  }

  @Put('allowlist')
  updateAllowlist(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    return this.schemas.updateAllowlist(user.id, id, body, requestMeta(request).ip);
  }
}
