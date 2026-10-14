import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { writeAuditLog, type AuditEntry } from './audit-log';

/** Writes audit rows from code that has no repository of its own, such as the worker. */
export interface AuditWriter {
  write(entry: AuditEntry): Promise<void>;
}

export const AUDIT_WRITER = Symbol('AUDIT_WRITER');

@Injectable()
export class PrismaAuditWriter implements AuditWriter {
  constructor(private readonly prisma: PrismaService) {}

  async write(entry: AuditEntry): Promise<void> {
    await writeAuditLog(this.prisma, entry);
  }
}
