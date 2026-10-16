// Runs sequelize-cli against DATABASE_URL from the root .env.
// Usage: node scripts/migrate.cjs [command]   (default db:migrate; also db:migrate:status)
//
// Before the first Sequelize run on a database Prisma migrated, it records the Prisma
// migrations that already ran as done in SequelizeMeta, the table where sequelize-cli keeps
// its history. Otherwise sequelize-cli would try to create tables that already exist.
const { config } = require('dotenv');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { Client } = require('pg');

const root = resolve(__dirname, '../../..');
config({ path: resolve(root, '.env'), quiet: true });
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to migrate');
  process.exit(1);
}

// Each Prisma migration and the file that replaces it. The Prisma baseline (SELECT 1) has none.
const FROM_PRISMA = {
  '20261009120000_baseline': null,
  '20261009180000_auth': '20261009180000-auth.cjs',
  '20261009190000_connections': '20261009190000-connections.cjs',
  '20261012120000_schema_allowlist': '20261012120000-schema-allowlist.cjs',
  '20261014120000_query_cache': '20261014120000-query-cache.cjs',
  '20261014150000_query_history': '20261014150000-query-history.cjs',
  '20261014170000_usage_counters': '20261014170000-usage-counters.cjs',
};

async function adoptPrismaHistory() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT to_regclass('public._prisma_migrations') AS prisma,
              to_regclass('public."SequelizeMeta"') AS sequelize`,
    );
    if (!rows[0].prisma || rows[0].sequelize) {
      return;
    }
    const applied = await client.query(
      `SELECT migration_name FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const names = [];
    for (const { migration_name: name } of applied.rows) {
      if (!(name in FROM_PRISMA)) {
        throw new Error(`Unknown Prisma migration ${name}; add it to FROM_PRISMA first`);
      }
      if (FROM_PRISMA[name]) {
        names.push(FROM_PRISMA[name]);
      }
    }
    // The same table sequelize-cli would create. One transaction: all names or none.
    await client.query('BEGIN');
    await client.query(
      'CREATE TABLE "SequelizeMeta" ("name" VARCHAR(255) NOT NULL PRIMARY KEY)',
    );
    for (const name of names) {
      await client.query('INSERT INTO "SequelizeMeta" ("name") VALUES ($1)', [name]);
    }
    await client.query('COMMIT');
    console.log(`Recorded ${names.length} migrations Prisma had already run.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const command = process.argv[2] ?? 'db:migrate';
  await adoptPrismaHistory();
  execFileSync(
    process.execPath,
    [require.resolve('sequelize-cli/lib/sequelize'), command],
    {
      stdio: 'inherit',
      env: process.env,
      cwd: resolve(__dirname, '..'),
    },
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
