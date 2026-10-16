import { SqlGuardCoreModule } from '@ayd/core';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { SqlGuardController } from './sql-guard.controller';

@Module({
  imports: [AuthModule, SqlGuardCoreModule],
  controllers: [SqlGuardController],
})
export class SqlGuardModule {}
