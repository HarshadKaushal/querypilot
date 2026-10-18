/**
 * One audit_log row. Metadata holds ids and outcomes only: never passwords, tokens, emails,
 * or result rows. userId is null once the account has been deleted.
 */
export interface AuditEntry {
  userId: string | null;
  eventType: string;
  metadata: Record<string, string>;
  ip: string | null;
}

/** Writes audit rows from code that has no repository of its own, such as the worker. */
export interface AuditWriter {
  write(entry: AuditEntry): Promise<void>;
}

export const AUDIT_WRITER = Symbol('AUDIT_WRITER');
