import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard, type PublicUser, CurrentUser } from '../auth';
import { ApiErrors } from '../common/openapi';
import { SqlGuardService } from '@ayd/core';

@ApiTags('sql guard')
@ApiBearerAuth()
@ApiErrors(401)
@Controller('v1/connections/:id/sql')
@UseGuards(AuthGuard)
export class SqlGuardController {
  constructor(private readonly guard: SqlGuardService) {}

  /** Checks SQL against the connection's allowlist. A rejection is a normal 200 answer. */
  @Post('check')
  @ApiOperation({
    summary: 'Check SQL against the allowlist without running it',
    description:
      'Never opens your database. Shows the SQL that would run: names qualified, `*` expanded, LIMIT capped.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['sql'],
      properties: { sql: { type: 'string' } },
      example: { sql: 'SELECT * FROM orders' },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'allowed: true with the rewritten SQL, or allowed: false with a code and reason.',
  })
  @ApiErrors(400, 404)
  @HttpCode(200)
  check(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() body: { sql?: unknown } | undefined,
  ) {
    return this.guard.check(user.id, id, body?.sql);
  }
}
