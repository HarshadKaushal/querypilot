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

export interface AuditInput {
  userId: string | null;
  eventType: string;
  metadata: Record<string, string>;
  ip: string | null;
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
  claimRefresh(id: string, replacedById: string, now: Date): Promise<boolean>;
  revokeFamily(familyId: string, now: Date): Promise<void>;
  revokeToken(id: string, now: Date): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  writeAudit(input: AuditInput): Promise<void>;
}

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
