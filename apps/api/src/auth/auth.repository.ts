import type { AuditEntry } from '@ayd/core';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  planTier: string;
}

export interface StoredRefresh {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

export interface NewRefreshToken {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  deviceInfo: string | null;
}

export interface GoogleProfileInput {
  googleSubject: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  lastLoginAt: Date;
}

export interface AuthRepository {
  upsertGoogleUser(input: GoogleProfileInput): Promise<PublicUser>;
  findUserById(id: string): Promise<PublicUser | null>;
  insertRefresh(input: NewRefreshToken): Promise<void>;
  findRefreshByHash(tokenHash: string): Promise<StoredRefresh | null>;
  /**
   * Marks the old token used and stores its replacement, together. False, with nothing
   * written, when the old token is already used, revoked, or expired.
   */
  rotateRefresh(oldId: string, next: NewRefreshToken, now: Date): Promise<boolean>;
  revokeFamily(familyId: string, now: Date): Promise<void>;
  revokeToken(id: string, now: Date): Promise<void>;
  /** Writes the audit entry and deletes the user in one step, so neither happens alone. */
  deleteUser(userId: string, audit: AuditEntry): Promise<void>;
  writeAudit(entry: AuditEntry): Promise<void>;
}

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');

/** Picks the fields a client may see from a stored user. */
export function toPublicUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    planTier: user.planTier,
  };
}
