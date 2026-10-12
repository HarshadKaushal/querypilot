import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { PublicUser } from './auth.repository';
import { AuthService } from './auth.service';

export interface AuthenticatedRequest extends Request {
  user: PublicUser;
}

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
