import { Sequelize, type SequelizeOptions } from 'sequelize-typescript';
import { models } from './tables';

/**
 * Settings shared by the app (through DatabaseModule in @ayd/core) and by scripts and tests.
 * The connection string is passed separately.
 */
export function sequelizeOptions(): SequelizeOptions {
  return {
    dialect: 'postgres',
    models,
    // Sequelize prints every query to the console by default. The app logs through pino.
    logging: false,
    // pg waits forever for a connection by default. Keep the 5-second limit the app has had.
    dialectOptions: { connectionTimeoutMillis: 5000 },
    // pg's own default pool size, which the app used before (Sequelize's default is 5).
    pool: { max: 10 },
  };
}

/** A Sequelize instance for scripts and tests. The API and worker get theirs from DatabaseModule. */
export function createSequelize(connectionString = process.env.DATABASE_URL): Sequelize {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  return new Sequelize(connectionString, sequelizeOptions());
}
