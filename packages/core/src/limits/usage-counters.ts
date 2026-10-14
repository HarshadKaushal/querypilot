import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UsageDelta {
  questions: number;
  rowsReturned: number;
  inputTokens: number;
  outputTokens: number;
}

export type DailyUsage = UsageDelta & { day: string };

/** Per-user daily usage, written by the worker as jobs finish and read by the API. */
export interface UsageCounters {
  add(userId: string, day: string, delta: UsageDelta): Promise<void>;
  get(userId: string, day: string): Promise<DailyUsage>;
}

export const USAGE_COUNTERS = Symbol('USAGE_COUNTERS');

@Injectable()
export class PrismaUsageCounters implements UsageCounters {
  constructor(private readonly prisma: PrismaService) {}

  async add(userId: string, day: string, delta: UsageDelta): Promise<void> {
    const date = new Date(`${day}T00:00:00.000Z`);
    await this.prisma.usageCounter.upsert({
      where: { userId_day: { userId, day: date } },
      create: { userId, day: date, ...delta },
      update: {
        questions: { increment: delta.questions },
        rowsReturned: { increment: delta.rowsReturned },
        inputTokens: { increment: delta.inputTokens },
        outputTokens: { increment: delta.outputTokens },
      },
    });
  }

  async get(userId: string, day: string): Promise<DailyUsage> {
    const row = await this.prisma.usageCounter.findUnique({
      where: { userId_day: { userId, day: new Date(`${day}T00:00:00.000Z`) } },
    });
    return {
      day,
      questions: row?.questions ?? 0,
      rowsReturned: row?.rowsReturned ?? 0,
      inputTokens: row?.inputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
    };
  }
}
