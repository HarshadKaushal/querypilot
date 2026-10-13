import { Module } from '@nestjs/common';
import { SchemaCoreModule } from '../schema/schema-core.module';
import { SqlGuardService } from './sql-guard.service';

/** Checks SQL against a connection's latest snapshot and allowlist. Opens no user database. */
@Module({
  imports: [SchemaCoreModule],
  providers: [SqlGuardService],
  exports: [SqlGuardService],
})
export class SqlGuardCoreModule {}
