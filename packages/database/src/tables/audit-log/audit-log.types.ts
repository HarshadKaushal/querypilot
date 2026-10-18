import type { Optional } from 'sequelize';

/** An audit_log row. userId is null once the account has been deleted. */
export interface AuditLogAttributes {
  id: string;
  userId: string | null;
  eventType: string;
  metadata: Record<string, string>;
  ip: string | null;
  createdAt: Date;
}

/** What creating a row needs. Columns that may be null or have a default can be left out. */
export type AuditLogCreationAttributes = Optional<
  AuditLogAttributes,
  'userId' | 'ip' | 'createdAt'
>;
