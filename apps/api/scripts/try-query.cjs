// Runs one question's SQL through the real pipeline against the sample database:
// connect (read-only check over SSL) -> read the schema -> SQL guard -> executor.
// Usage: npm run try-query --workspace=@ayd/api -- "SELECT region, count(*) FROM customers GROUP BY region"
// Needs `npm run up:deps`, migrations, and SAMPLE_DATABASE_URL in the root .env. It creates
// a temporary user and deletes it, with its connection and snapshot, before exiting.
process.env.LOG_LEVEL ??= 'error';

const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { NestFactory } = require('@nestjs/core');
const dist = (path) => require(`../dist/${path}`);

// Compile here rather than chaining "npm run build &&" in package.json: on Windows npm
// escapes the SQL argument for cmd.exe with ^, and a chained command never removes them.
execFileSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
  {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
  },
);

async function main() {
  const sql = process.argv.slice(2).join(' ').trim();
  if (!sql) {
    console.error('Usage: npm run try-query --workspace=@ayd/api -- "SELECT ..."');
    process.exit(2);
  }
  // Loading the config module reads the root .env.
  dist('config/env');
  if (!process.env.SAMPLE_DATABASE_URL) {
    console.error('SAMPLE_DATABASE_URL is not set. Copy it from .env.example into .env.');
    process.exit(2);
  }
  const sample = new URL(process.env.SAMPLE_DATABASE_URL);
  const context = await NestFactory.createApplicationContext(
    dist('app.module').AppModule,
    {
      logger: false,
    },
  );
  const prisma = context.get(dist('prisma/prisma.service').PrismaService);
  const connections = context.get(
    dist('connections/connection.service').ConnectionService,
  );
  const schemas = context.get(dist('schema/schema.service').SchemaService);
  const guard = context.get(dist('sql-guard/sql-guard.service').SqlGuardService);
  const executor = context.get(dist('user-database/query-executor').QueryExecutor);

  const userId = randomUUID();
  try {
    await prisma.user.create({
      data: {
        id: userId,
        googleSubject: `try-query:${userId}`,
        email: `${userId}@try-query.local`,
        name: 'try-query',
        lastLoginAt: new Date(),
      },
    });
    const connection = await connections.create(
      userId,
      {
        label: 'Sample (try-query)',
        host: sample.hostname,
        port: Number(sample.port || 5432),
        databaseName: sample.pathname.slice(1),
        username: decodeURIComponent(sample.username),
        password: decodeURIComponent(sample.password),
        sslMode: 'require',
      },
      null,
    );
    await schemas.refresh(userId, connection.id, null);

    const verdict = await guard.check(userId, connection.id, sql);
    if (!verdict.allowed) {
      console.log(`Rejected by the guard (${verdict.code}): ${verdict.reason}`);
      return;
    }
    console.log(`Guarded SQL: ${verdict.sql}\n`);
    const target = await connections.resolveTarget(userId, connection.id);
    if (!target.ok) {
      console.log(`Could not reach the database: ${target.error.message}`);
      return;
    }
    const result = await executor.run({
      connectionId: connection.id,
      target: target.request,
      sql: verdict.sql,
      guardLimitApplied: verdict.limitApplied,
    });
    if (!result.ok) {
      console.log(`Executor refused or failed (${result.code}): ${result.message}`);
      return;
    }
    console.table(
      result.rows.map((row) =>
        Object.fromEntries(result.columns.map((c, i) => [c.name, row[i]])),
      ),
    );
    const cut = result.truncated ? `, cut by the ${result.truncated} cap` : '';
    console.log(`${result.rowCount} row(s) in ${result.durationMs} ms${cut}.`);
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } });
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
