import { Injectable } from '@nestjs/common';
import { UsageCounter } from '@ayd/database';
import { DatabaseService } from '../database/database.service';
import type { DailyUsage, UsageCounters, UsageDelta } from './usage-counters.repository';

// The Sequelize implementation of UsageCounters: one usage_counters row per user and day.

@Injectable()
export class SequelizeUsageCounters implements UsageCounters {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Adds to the day's row, creating it on the first job of the day. Raw SQL, because
   * Sequelize's upsert can only overwrite a value, not add to it. Postgres does the adding,
   * so two jobs finishing at the same moment both count.
   */
  async add(userId: string, day: string, delta: UsageDelta): Promise<void> {
    await this.db.sequelize.query(
      `INSERT INTO usage_counters
         (user_id, day, questions, rows_returned, input_tokens, output_tokens)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, day) DO UPDATE SET
         questions = usage_counters.questions + EXCLUDED.questions,
         rows_returned = usage_counters.rows_returned + EXCLUDED.rows_returned,
         input_tokens = usage_counters.input_tokens + EXCLUDED.input_tokens,
         output_tokens = usage_counters.output_tokens + EXCLUDED.output_tokens`,
      {
        // Sent as parameters ($1 to $6), never pasted into the SQL text.
        bind: [
          userId,
          day,
          delta.questions,
          delta.rowsReturned,
          delta.inputTokens,
          delta.outputTokens,
        ],
      },
    );
  }

  async get(userId: string, day: string): Promise<DailyUsage> {
    const row = await UsageCounter.findOne({ where: { userId, day } });
    return {
      day,
      questions: row?.questions ?? 0,
      rowsReturned: row?.rowsReturned ?? 0,
      inputTokens: row?.inputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
    };
  }
}
