import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 no longer reads .env itself. The repository keeps one .env at its root.
config({ path: resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
