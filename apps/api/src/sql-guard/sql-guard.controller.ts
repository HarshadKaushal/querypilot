import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { PublicUser } from '../auth/auth.repository';
import { CurrentUser } from '../auth/current-user.decorator';
import { SqlGuardService } from './sql-guard.service';

@Controller('v1/connections/:id/sql')
@UseGuards(AuthGuard)
export class SqlGuardController {
  constructor(private readonly guard: SqlGuardService) {}

  /** Checks SQL against the connection's allowlist. A rejection is a normal 200 answer. */
  @Post('check')
  @HttpCode(200)
  check(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() body: { sql?: unknown } | undefined,
  ) {
    return this.guard.check(user.id, id, body?.sql);
  }
}
