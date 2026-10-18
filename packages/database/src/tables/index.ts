// One folder per table: its model, its attribute types, and the enums its columns hold.
import { AllowedObject } from './allowed-object';
import { AuditLog } from './audit-log';
import { Connection } from './connection';
import { QueryCacheEntry } from './query-cache-entry';
import { QueryRecord } from './query-record';
import { RefreshToken } from './refresh-token';
import { SchemaSnapshot } from './schema-snapshot';
import { UsageCounter } from './usage-counter';
import { User } from './user';

export * from './allowed-object';
export * from './audit-log';
export * from './connection';
export * from './query-cache-entry';
export * from './query-record';
export * from './refresh-token';
export * from './schema-snapshot';
export * from './usage-counter';
export * from './user';

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
