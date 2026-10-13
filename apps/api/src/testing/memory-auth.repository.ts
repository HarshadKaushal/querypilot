import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '@ayd/core';
import {
  toPublicUser,
  type AuthRepository,
  type GoogleProfileInput,
  type NewRefreshToken,
  type PublicUser,
  type StoredRefresh,
} from '../auth/auth.repository';

interface MemoryUser extends PublicUser {
  googleSubject: string;
  lastLoginAt: Date;
}

interface MemoryRefresh extends StoredRefresh {
  tokenHash: string;
  deviceInfo: string | null;
}

export class MemoryAuthRepository implements AuthRepository {
  readonly users: MemoryUser[] = [];
  readonly tokens: MemoryRefresh[] = [];
  readonly audits: AuditEntry[] = [];

  async upsertGoogleUser(input: GoogleProfileInput): Promise<PublicUser> {
    const existing = this.users.find(
      (user) => user.googleSubject === input.googleSubject,
    );
    if (existing) {
      existing.email = input.email;
      existing.name = input.name;
      existing.avatarUrl = input.avatarUrl;
      existing.lastLoginAt = input.lastLoginAt;
      return toPublicUser(existing);
    }
    const created: MemoryUser = {
      id: randomUUID(),
      googleSubject: input.googleSubject,
      email: input.email,
      name: input.name,
      avatarUrl: input.avatarUrl,
      planTier: 'free',
      lastLoginAt: input.lastLoginAt,
    };
    this.users.push(created);
    return toPublicUser(created);
  }

  async findUserById(id: string): Promise<PublicUser | null> {
    const user = this.users.find((row) => row.id === id);
    return user ? toPublicUser(user) : null;
  }

  async insertRefresh(input: NewRefreshToken): Promise<void> {
    this.tokens.push({
      id: input.id,
      userId: input.userId,
      familyId: input.familyId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      replacedById: null,
      deviceInfo: input.deviceInfo,
    });
  }

  async findRefreshByHash(tokenHash: string): Promise<StoredRefresh | null> {
    const row = this.tokens.find((token) => token.tokenHash === tokenHash);
    return row ? stored(row) : null;
  }

  async rotateRefresh(oldId: string, next: NewRefreshToken, now: Date): Promise<boolean> {
    const row = this.tokens.find((token) => token.id === oldId);
    if (!row || row.revokedAt || row.replacedById || row.expiresAt <= now) {
      return false;
    }
    row.revokedAt = now;
    row.replacedById = next.id;
    await this.insertRefresh(next);
    return true;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    for (const token of this.tokens) {
      if (token.familyId === familyId && !token.revokedAt) {
        token.revokedAt = now;
      }
    }
  }

  async revokeToken(id: string, now: Date): Promise<void> {
    const row = this.tokens.find((token) => token.id === id);
    if (row && !row.revokedAt) {
      row.revokedAt = now;
    }
  }

  async deleteUser(userId: string, audit: AuditEntry): Promise<void> {
    await this.writeAudit(audit);
    const index = this.users.findIndex((user) => user.id === userId);
    if (index >= 0) {
      this.users.splice(index, 1);
    }
    // Mirrors the database: refresh tokens cascade with the user, and audit rows keep
    // their history with the user id cleared.
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      if (this.tokens[i]!.userId === userId) {
        this.tokens.splice(i, 1);
      }
    }
    for (const audit of this.audits) {
      if (audit.userId === userId) {
        audit.userId = null;
      }
    }
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    this.audits.push({ ...entry, metadata: { ...entry.metadata } });
  }
}

function stored(row: MemoryRefresh): StoredRefresh {
  return {
    id: row.id,
    userId: row.userId,
    familyId: row.familyId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedById: row.replacedById,
  };
}
