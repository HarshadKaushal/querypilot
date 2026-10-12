import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@ayd/database';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AuditInput,
  AuthRepository,
  GoogleProfileInput,
  NewRefreshToken,
  PublicUser,
  StoredRefresh,
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

  async claimRefresh(id: string, replacedById: string, now: Date): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null, replacedById: null, expiresAt: { gt: now } },
      data: { revokedAt: now, replacedById },
    });
    return result.count === 1;
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

  async deleteUser(userId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }

  async writeAudit(input: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: randomUUID(),
        userId: input.userId,
        eventType: input.eventType,
        metadata: input.metadata as Prisma.InputJsonObject,
        ip: input.ip,
      },
    });
  }
}

function toPublicUser(row: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  planTier: string;
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    planTier: row.planTier,
  };
}
