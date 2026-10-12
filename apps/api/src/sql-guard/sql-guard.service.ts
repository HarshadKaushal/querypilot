import { Inject, Injectable } from '@nestjs/common';
import { checkSql, type RejectionCode } from '@ayd/sql-guard';
import { invalidRequest } from '../common/errors/app.exception';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';
import { SchemaService } from '../schema/schema.service';

export type SqlCheckResult =
  | {
      allowed: true;
      /** The SQL that would run: fully qualified, * expanded, LIMIT capped. */
      sql: string;
      limitApplied: boolean;
      rowCap: number;
      schemaVersion: number;
    }
  | { allowed: false; code: RejectionCode; reason: string; schemaVersion: number };

// The API's wrapper around @ayd/sql-guard: it supplies the connection's latest snapshot and
// allowlist and the configured row cap. Checking never opens the user's database.
@Injectable()
export class SqlGuardService {
  constructor(
    private readonly schemas: SchemaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async check(
    userId: string,
    connectionId: string,
    sql: unknown,
  ): Promise<SqlCheckResult> {
    if (typeof sql !== 'string') {
      throw invalidRequest();
    }
    // Checks ownership, and that a snapshot exists, before the guard runs.
    const allowlist = await this.schemas.allowlist(userId, connectionId);
    const verdict = await checkSql(sql, {
      rowCap: this.env.SQL_ROW_CAP,
      tables: allowlist.tables.map((table) => ({
        schema: table.schema,
        name: table.name,
        allowed: table.allowed,
        columns: table.columns.map((column) => ({
          name: column.name,
          allowed: column.allowed,
        })),
      })),
    });
    if (!verdict.ok) {
      return {
        allowed: false,
        code: verdict.code,
        reason: verdict.reason,
        schemaVersion: allowlist.version,
      };
    }
    return {
      allowed: true,
      sql: verdict.sql,
      limitApplied: verdict.limitApplied,
      rowCap: this.env.SQL_ROW_CAP,
      schemaVersion: allowlist.version,
    };
  }
}
