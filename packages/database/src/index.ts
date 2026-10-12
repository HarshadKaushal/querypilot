import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export { Prisma, PrismaClient } from './generated/prisma/client';

/**
 * Prisma 7 reaches Postgres through the pg driver. pg waits forever for a connection by
 * default, so this keeps the 5-second limit Prisma 6 had.
 */
export function postgresAdapter(connectionString: string): PrismaPg {
  return new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 });
}

/** A client for scripts and tests. The API builds its own through PrismaService. */
export function createPrismaClient(
  connectionString = process.env.DATABASE_URL,
): PrismaClient {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  return new PrismaClient({ adapter: postgresAdapter(connectionString) });
}
