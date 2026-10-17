import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../sign-in/auth.service';
import type { PublicUser } from '../user';

export interface AuthenticatedRequest extends Request {
  user: PublicUser;
}

/**
 * Protects a route: `@UseGuards(AuthGuard)` lets a request in only with a valid access token
 * in `Authorization: Bearer <token>`, and puts the signed-in user on `request.user`, where
 * `@CurrentUser()` reads it. Routes without the guard are public.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  // A missing, malformed, or expired token, or one for a deleted user, ends in
  // UNAUTHENTICATED. An empty token fails verification like any other bad token.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : '';
    const userId = await this.auth.userIdFromAccessToken(token);
    request.user = await this.auth.currentUser(userId);
    return true;
  }
}
