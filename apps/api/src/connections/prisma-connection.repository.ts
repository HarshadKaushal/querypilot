import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@ayd/database';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ConnectionRepository,
  NewConnection,
  PublicConnection,
  StoredConnection,
} from './connection.repository';

@Injectable()
export class PrismaConnectionRepository implements ConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(input: NewConnection): Promise<PublicConnection> {
    const row = await this.prisma.connection.create({ data: input });
    return toPublic(row);
  }

  async list(userId: string): Promise<PublicConnection[]> {
    const rows = await this.prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPublic);
  }

  async findOwned(userId: string, id: string): Promise<StoredConnection | null> {
    const row = await this.prisma.connection.findFirst({ where: { id, userId } });
    return row ? toStored(row) : null;
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<NewConnection>,
    options: { resetSchema?: boolean } = {},
  ): Promise<PublicConnection | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.connection.findFirst({ where: { id, userId } });
      if (!existing) {
        return null;
      }
      const row = await tx.connection.update({ where: { id }, data: patch });
      if (options.resetSchema) {
        // The connection now points at another database, so the old schema and choices
        // must not be applied to it.
        await tx.allowedObject.deleteMany({ where: { connectionId: id } });
        await tx.schemaSnapshot.deleteMany({ where: { connectionId: id } });
      }
      return toPublic(row);
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.connection.deleteMany({ where: { id, userId } });
    return result.count === 1;
  }

  async writeAudit(input: {
    userId: string;
    eventType: string;
    metadata: Record<string, string>;
    ip: string | null;
  }): Promise<void> {
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

function toPublic(row: {
  id: string;
  label: string;
  host: string;
  port: number;
  databaseName: string;
  sslMode: string;
  status: string;
  lastTestedAt: Date | null;
  sendSampleRowsToLlm: boolean;
  keyVersion: number;
}): PublicConnection {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    databaseName: row.databaseName,
    sslMode: row.sslMode,
    status: row.status,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
    sendSampleRowsToLlm: row.sendSampleRowsToLlm,
    keyVersion: row.keyVersion,
  };
}

function toStored(
  row: Parameters<typeof toPublic>[0] & {
    userId: string;
    usernameCiphertext: string;
    usernameIv: string;
    usernameTag: string;
    passwordCiphertext: string;
    passwordIv: string;
    passwordTag: string;
    encryptedDataKey: string;
    dataKeyIv: string;
    dataKeyTag: string;
  },
): StoredConnection {
  return {
    ...toPublic(row),
    userId: row.userId,
    usernameCiphertext: row.usernameCiphertext,
    usernameIv: row.usernameIv,
    usernameTag: row.usernameTag,
    passwordCiphertext: row.passwordCiphertext,
    passwordIv: row.passwordIv,
    passwordTag: row.passwordTag,
    encryptedDataKey: row.encryptedDataKey,
    dataKeyIv: row.dataKeyIv,
    dataKeyTag: row.dataKeyTag,
    keyVersion: row.keyVersion,
  };
}
