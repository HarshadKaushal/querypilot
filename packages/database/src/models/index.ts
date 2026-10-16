import { AllowedObject } from './allowed-object.model';
import { AuditLog } from './audit-log.model';
import { Connection } from './connection.model';
import { QueryCacheEntry } from './query-cache-entry.model';
import { QueryRecord } from './query-record.model';
import { RefreshToken } from './refresh-token.model';
import { SchemaSnapshot } from './schema-snapshot.model';
import { UsageCounter } from './usage-counter.model';
import { User } from './user.model';

export {
  AllowedObject,
  AuditLog,
  Connection,
  QueryCacheEntry,
  QueryRecord,
  RefreshToken,
  SchemaSnapshot,
  UsageCounter,
  User,
};

/** Every model, for the Sequelize instance to register. */
export const models = [
  User,
  RefreshToken,
  AuditLog,
  Connection,
  SchemaSnapshot,
  AllowedObject,
  QueryCacheEntry,
  QueryRecord,
  UsageCounter,
];
