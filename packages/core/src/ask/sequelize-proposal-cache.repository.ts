import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { QueryCacheEntry } from '@ayd/database';
import { Op, literal } from 'sequelize';
import { DatabaseService } from '../database/database.service';
import type { CachedProposal, ProposalCache } from './proposal-cache.repository';

// The Sequelize implementation of ProposalCache: the `query_cache` table (model
// QueryCacheEntry). Hit counts are added by Postgres, and saving an entry also drops the
// connection's entries for older schema fingerprints, in one transaction.

@Injectable()
export class SequelizeProposalCache implements ProposalCache {
  constructor(private readonly db: DatabaseService) {}

  async find(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
  ): Promise<CachedProposal | null> {
    const where = { connectionId, fingerprint, questionHash: questionKey };
    const row = await QueryCacheEntry.findOne({ where });
    if (!row) {
      return null;
    }
    // hits + 1 is computed by Postgres, so two hits at the same moment both count.
    await QueryCacheEntry.update(
      { hits: literal('hits + 1'), lastUsedAt: new Date() },
      { where },
    );
    return {
      sql: row.sql,
      assumptions: Array.isArray(row.assumptions) ? row.assumptions : [],
      explanation: row.explanation,
      model: row.model,
    };
  }

  async save(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
    proposal: CachedProposal,
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await QueryCacheEntry.destroy({
        where: { connectionId, fingerprint: { [Op.ne]: fingerprint } },
        transaction,
      });
      // INSERT ... ON CONFLICT (connection_id, fingerprint, question_hash) DO UPDATE SET
      // only the listed columns, so an existing entry keeps its id, hits, and created_at.
      await QueryCacheEntry.bulkCreate(
        [
          {
            id: randomUUID(),
            connectionId,
            fingerprint,
            questionHash: questionKey,
            sql: proposal.sql,
            assumptions: proposal.assumptions,
            explanation: proposal.explanation,
            model: proposal.model,
            lastUsedAt: new Date(),
          },
        ],
        {
          conflictAttributes: ['connectionId', 'fingerprint', 'questionHash'],
          updateOnDuplicate: ['sql', 'assumptions', 'explanation', 'model', 'lastUsedAt'],
          transaction,
        },
      );
    });
  }

  async forget(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
  ): Promise<void> {
    await QueryCacheEntry.destroy({
      where: { connectionId, fingerprint, questionHash: questionKey },
    });
  }
}
