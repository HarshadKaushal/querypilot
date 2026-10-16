import { Controller, Delete, Get, HttpCode, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, CurrentUser, AuthGuard, type PublicUser } from '../auth';
import { requestMeta } from '../common/request-meta';

@Controller('v1/users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  me(@CurrentUser() user: PublicUser): { user: PublicUser } {
    return { user };
  }

  @Delete('me')
  @HttpCode(204)
  async deleteMe(
    @CurrentUser() user: PublicUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.deleteAccount(user.id, requestMeta(request));
  }
}
