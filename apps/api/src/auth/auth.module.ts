import { Module } from '@nestjs/common';
import { APP_ENV } from '../config/app-config.module';
import { LimitsModule } from '../limits/limits.module';
import type { AppEnv } from '../config/env';
import { AuthGuard } from './protect-routes/auth.guard';
import { AuthController } from './sign-in/auth.controller';
import { AuthService } from './sign-in/auth.service';
import { GOOGLE_CLIENT, GoogleOAuthClient } from './sign-in/google.client';
import { AUTH_REPOSITORY } from './storage/auth.repository';
import { SequelizeAuthRepository } from './storage/sequelize-auth.repository';
import { TokenService } from './tokens/token.service';

@Module({
  imports: [LimitsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    AuthGuard,
    SequelizeAuthRepository,
    { provide: AUTH_REPOSITORY, useExisting: SequelizeAuthRepository },
    {
      provide: GOOGLE_CLIENT,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => new GoogleOAuthClient(env),
    },
  ],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}
