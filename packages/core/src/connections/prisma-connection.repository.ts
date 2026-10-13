import { Injectable } from '@nestjs/common';
import { writeAuditLog, type AuditEntry } from '../audit/audit-log';
import { PrismaService } from '../prisma/prisma.service';
import {
  toPublicConnection,
  type ConnectionRepository,
  type NewConnection,
  type PublicConnection,
  type StoredConnection,
} from './connection.repository';

@Injectable()
export class PrismaConnectionRepository implements ConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(input: NewConnection): Promise<PublicConnection> {
    const row = await this.prisma.connection.create({ data: input });
    return toPublicConnection(row);
  }

  async list(userId: string): Promise<PublicConnection[]> {
    const rows = await this.prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPublicConnection);
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
      return toPublicConnection(row);
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.connection.deleteMany({ where: { id, userId } });
    return result.count === 1;
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    await writeAuditLog(this.prisma, entry);
  }
}

function toStored(
  row: Parameters<typeof toPublicConnection>[0] & {
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
    ...toPublicConnection(row),
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
