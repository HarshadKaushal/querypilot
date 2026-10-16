import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PublicUser } from '../user';
import type { AuthenticatedRequest } from './auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUser => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
