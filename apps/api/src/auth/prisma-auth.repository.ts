import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { writeAuditLog, type AuditEntry } from '../audit/audit-log';
import { PrismaService } from '../prisma/prisma.service';
import {
  toPublicUser,
  type AuthRepository,
  type GoogleProfileInput,
  type NewRefreshToken,
  type PublicUser,
  type StoredRefresh,
} from './auth.repository';

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertGoogleUser(input: GoogleProfileInput): Promise<PublicUser> {
    const existing = await this.prisma.user.findUnique({
      where: { googleSubject: input.googleSubject },
    });
    const row = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            email: input.email,
            name: input.name,
            avatarUrl: input.avatarUrl,
            lastLoginAt: input.lastLoginAt,
          },
        })
      : await this.prisma.user.create({
          data: {
            id: randomUUID(),
            googleSubject: input.googleSubject,
            email: input.email,
            name: input.name,
            avatarUrl: input.avatarUrl,
            planTier: 'free',
            lastLoginAt: input.lastLoginAt,
          },
        });
    return toPublicUser(row);
  }

  async findUserById(id: string): Promise<PublicUser | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? toPublicUser(row) : null;
  }

  async insertRefresh(input: NewRefreshToken): Promise<void> {
    await this.prisma.refreshToken.create({ data: input });
  }

  async findRefreshByHash(tokenHash: string): Promise<StoredRefresh | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
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
    return this.prisma.$transaction(async (tx) => {
      // The claim matches only an unused row, so of two concurrent refreshes with the same
      // token, one wins.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: oldId, revokedAt: null, replacedById: null, expiresAt: { gt: now } },
        data: { revokedAt: now, replacedById: next.id },
      });
      if (claimed.count !== 1) {
        return false;
      }
      await tx.refreshToken.create({ data: next });
      return true;
    });
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeToken(id: string, now: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async deleteUser(userId: string, audit: AuditEntry): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await writeAuditLog(tx, audit);
      // Refresh tokens cascade. The audit row stays, with user_id set to null.
      await tx.user.delete({ where: { id: userId } });
    });
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    await writeAuditLog(this.prisma, entry);
  }
}
