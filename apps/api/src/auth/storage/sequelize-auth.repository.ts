import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type AuditEntry, DatabaseService, writeAuditLog } from '@ayd/core';
import { PlanTier, RefreshToken, User } from '@ayd/database';
import { Op } from 'sequelize';
import { toPublicUser, type PublicUser } from '../user';
import type {
  AuthRepository,
  GoogleProfileInput,
  NewRefreshToken,
  StoredRefresh,
} from './auth.repository';

/**
 * Stores users, refresh tokens, and auth audit rows in the app database with Sequelize. It
 * is the real AuthRepository; unit tests use MemoryAuthRepository (src/testing/) instead.
 * Only token hashes are stored, never a refresh token itself.
 */
@Injectable()
export class SequelizeAuthRepository implements AuthRepository {
  constructor(private readonly db: DatabaseService) {}

  async upsertGoogleUser(input: GoogleProfileInput): Promise<PublicUser> {
    const existing = await User.findOne({
      where: { googleSubject: input.googleSubject },
    });
    const row = existing
      ? await existing.update({
          email: input.email,
          name: input.name,
          avatarUrl: input.avatarUrl,
          lastLoginAt: input.lastLoginAt,
        })
      : await User.create({
          id: randomUUID(),
          googleSubject: input.googleSubject,
          email: input.email,
          name: input.name,
          avatarUrl: input.avatarUrl,
          planTier: PlanTier.Free,
          lastLoginAt: input.lastLoginAt,
        });
    return toPublicUser(row);
  }

  async findUserById(id: string): Promise<PublicUser | null> {
    const row = await User.findByPk(id);
    return row ? toPublicUser(row) : null;
  }

  async insertRefresh(input: NewRefreshToken): Promise<void> {
    await RefreshToken.create(input);
  }

  async findRefreshByHash(tokenHash: string): Promise<StoredRefresh | null> {
    const row = await RefreshToken.findOne({ where: { tokenHash } });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userId: row.userId,
      familyId: row.familyId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      replacedById: row.replacedById,
    };
  }

  async rotateRefresh(oldId: string, next: NewRefreshToken, now: Date): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      // The claim matches only an unused row, so of two concurrent refreshes with the same
      // token, one wins. Model.update returns [number of rows changed].
      const [claimed] = await RefreshToken.update(
        { revokedAt: now, replacedById: next.id },
        {
          where: {
            id: oldId,
            revokedAt: null,
            replacedById: null,
            expiresAt: { [Op.gt]: now },
          },
          transaction,
        },
      );
      if (claimed !== 1) {
        return false;
      }
      await RefreshToken.create(next, { transaction });
      return true;
    });
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await RefreshToken.update(
      { revokedAt: now },
      { where: { familyId, revokedAt: null } },
    );
  }

  async revokeToken(id: string, now: Date): Promise<void> {
    await RefreshToken.update({ revokedAt: now }, { where: { id, revokedAt: null } });
  }

  async deleteUser(userId: string, audit: AuditEntry): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await writeAuditLog(audit, transaction);
      // Refresh tokens cascade. The audit row stays, with user_id set to null.
      await User.destroy({ where: { id: userId }, transaction });
    });
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    await writeAuditLog(entry);
  }
}
