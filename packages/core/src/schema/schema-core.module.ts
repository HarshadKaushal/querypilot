import { Module } from '@nestjs/common';
import { ConnectionsCoreModule } from '../connections/connections-core.module';
import { UserDatabaseModule } from '../user-database/user-database.module';
import { SequelizeSchemaRepository } from './sequelize-schema.repository';
import { SCHEMA_REPOSITORY } from './schema.repository';
import { SchemaService } from './schema.service';

/** Schema snapshots and the allowlist, without HTTP routes. */
@Module({
  imports: [ConnectionsCoreModule, UserDatabaseModule],
  providers: [
    SchemaService,
    SequelizeSchemaRepository,
    { provide: SCHEMA_REPOSITORY, useExisting: SequelizeSchemaRepository },
  ],
  exports: [SchemaService],
})
export class SchemaCoreModule {}
