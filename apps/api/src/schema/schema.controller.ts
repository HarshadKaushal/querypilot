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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard, type PublicUser, CurrentUser } from '../auth';
import { ApiErrors } from '../common/openapi';
import { requestMeta } from '../common/request-meta';
import { ConnectionService, JobQueue, SchemaService } from '@ayd/core';
import { JobViewDto } from '../jobs/jobs.responses';
import { UpdateAllowlistDto } from './allowlist.dto';
import { AllowlistViewDto, SchemaViewDto } from './schema.responses';

@ApiTags('schema and allowlist')
@ApiBearerAuth()
@ApiErrors(401)
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
  @ApiOperation({ summary: "Read the database's tables and columns again (queued)" })
  @ApiResponse({
    status: 202,
    description: 'The queued schema.refresh job.',
    type: JobViewDto,
  })
  @ApiErrors(404, 429)
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
  @ApiOperation({ summary: 'The latest schema snapshot: every table and column found' })
  @ApiResponse({
    status: 200,
    description: 'The allowed part of the snapshot.',
    type: SchemaViewDto,
  })
  @ApiErrors(404)
  schema(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.schemas.schema(user.id, id);
  }

  @Get('allowlist')
  @ApiOperation({ summary: 'Which tables and columns the AI may see' })
  @ApiResponse({
    status: 200,
    description: 'Every table and column, with whether the AI may see it.',
    type: AllowlistViewDto,
  })
  @ApiErrors(404)
  allowlist(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.schemas.allowlist(user.id, id);
  }

  @Put('allowlist')
  @ApiOperation({
    summary: 'Replace the allowlist',
    description:
      'Lists every table (and its columns) the AI may see; anything left out is hidden. `version` is the schema version from GET allowlist. Only the columns listed under a table are allowed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Saved. The answer is what the AI may now see (the schema view).',
    type: SchemaViewDto,
  })
  @ApiErrors(400, 404)
  updateAllowlist(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
    // The pipe checks the shape; SchemaService checks it against the latest snapshot.
    @Body() body: UpdateAllowlistDto,
  ) {
    return this.schemas.updateAllowlist(user.id, id, body, requestMeta(request).ip);
  }
}
