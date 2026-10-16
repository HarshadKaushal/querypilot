import { DatabaseService } from '@ayd/core';
import { createSequelize } from '@ayd/database';

/**
 * The application database for integration tests, outside Nest. Creating the Sequelize
 * instance also binds the models (User, Connection, ...) to it, so tests can use them
 * directly. Close it in afterAll with `db.sequelize.close()`.
 */
export function openAppDatabase(connectionString?: string): DatabaseService {
  return new DatabaseService(createSequelize(connectionString));
}
