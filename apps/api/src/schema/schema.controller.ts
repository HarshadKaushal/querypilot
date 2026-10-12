import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { PublicUser } from '../auth/auth.repository';
import { requestMeta } from '../auth/cookies';
import { CurrentUser } from '../auth/current-user.decorator';
import { SchemaService } from './schema.service';

@Controller('v1/connections/:id')
@UseGuards(AuthGuard)
export class SchemaController {
  constructor(private readonly schemas: SchemaService) {}

  @Post('schema/refresh')
  refresh(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.schemas.refresh(user.id, id, requestMeta(request).ip);
  }

  @Get('schema')
  schema(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.schemas.schema(user.id, id);
  }

  @Get('allowlist')
  allowlist(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.schemas.allowlist(user.id, id);
  }
}
