import { Module } from '@nestjs/common';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';
import { AUTH_REPOSITORY } from './auth.repository';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { GOOGLE_CLIENT, GoogleOAuthClient } from './google.client';
import { PrismaAuthRepository } from './prisma-auth.repository';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    AuthGuard,
    PrismaAuthRepository,
    { provide: AUTH_REPOSITORY, useExisting: PrismaAuthRepository },
    {
      provide: GOOGLE_CLIENT,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => new GoogleOAuthClient(env),
    },
  ],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}
