import { ConnectionsCoreModule, JobQueueModule, SchemaCoreModule } from '@ayd/core';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchemaController } from './schema.controller';

@Module({
  imports: [AuthModule, ConnectionsCoreModule, JobQueueModule, SchemaCoreModule],
  controllers: [SchemaController],
})
export class SchemaModule {}
