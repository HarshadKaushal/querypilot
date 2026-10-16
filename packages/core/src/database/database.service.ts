import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/**
 * The application database for repositories: transactions, raw SQL, and the health check.
 * Simple reads and writes go through the models (User.findOne and so on), which Sequelize
 * binds to this same connection when DatabaseModule registers them.
 */
@Injectable()
export class DatabaseService {
  constructor(@InjectConnection() readonly sequelize: Sequelize) {}

  /**
   * Runs `work` in one transaction: committed when it resolves, rolled back when it throws.
   * Every query inside must be given `{ transaction }`, or it runs outside the transaction.
   */
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  async ping(): Promise<void> {
    await this.sequelize.query('SELECT 1');
  }
}
