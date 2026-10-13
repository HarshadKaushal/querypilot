import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConnectionsModule } from '../connections/connections.module';
import { UserDatabaseModule } from '@ayd/core';
import { PrismaSchemaRepository } from './prisma-schema.repository';
import { SchemaController } from './schema.controller';
import { SCHEMA_REPOSITORY } from './schema.repository';
import { SchemaService } from './schema.service';

@Module({
  imports: [AuthModule, ConnectionsModule, UserDatabaseModule],
  controllers: [SchemaController],
  providers: [
    SchemaService,
    PrismaSchemaRepository,
    { provide: SCHEMA_REPOSITORY, useExisting: PrismaSchemaRepository },
  ],
  exports: [SchemaService],
})
export class SchemaModule {}
