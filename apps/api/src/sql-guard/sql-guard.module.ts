import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchemaModule } from '../schema/schema.module';
import { SqlGuardController } from './sql-guard.controller';
import { SqlGuardService } from './sql-guard.service';

@Module({
  imports: [AuthModule, SchemaModule],
  controllers: [SqlGuardController],
  providers: [SqlGuardService],
  exports: [SqlGuardService],
})
export class SqlGuardModule {}
