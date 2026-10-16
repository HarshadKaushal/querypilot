import { Controller, Delete, Get, HttpCode, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService, CurrentUser, AuthGuard, type PublicUser } from '../auth';
import { ApiErrors } from '../common/openapi';
import { requestMeta } from '../common/request-meta';

@ApiTags('users')
@ApiBearerAuth()
@ApiErrors(401)
@Controller('v1/users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiResponse({ status: 200, description: 'id, email, name, avatarUrl, planTier.' })
  me(@CurrentUser() user: PublicUser): { user: PublicUser } {
    return { user };
  }

  @Delete('me')
  @ApiOperation({
    summary: 'Delete your account',
    description:
      'Deletes the user, their connections, and their history. Cannot be undone.',
  })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @HttpCode(204)
  async deleteMe(
    @CurrentUser() user: PublicUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.deleteAccount(user.id, requestMeta(request));
  }
}
