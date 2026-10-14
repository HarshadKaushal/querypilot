import { randomUUID } from 'node:crypto';
import {
  AskJobRunner,
  type ConnectionJobRunner,
  ConnectionPools,
  ConnectionService,
  JobCancellation,
  JobProcessor,
  JobQueue,
  type JobView,
  LlmClient,
  PrismaConnectionRepository,
  PrismaProposalCache,
  PrismaSchemaRepository,
  PrismaService,
  QueryExecutor,
  type QueryJobRunner,
  RedisCoordination,
  RedisService,
  type RunningJobWorker,
  SchemaService,
  SqlGuardService,
  startJobWorker,
  UserDatabaseProbe,
  UserJobSlots,
} from '@ayd/core';
import { FakeLlmProvider } from '@ayd/core/testing';
import type { Logger } from 'nestjs-pino';
import { loadEnv } from '../../src/config/env';
import {
  createScratchDatabase,
  plainClients,
  plainPools,
  type ScratchDatabase,
} from '../helpers/scratch-database';

// Phase 7 step 2 acceptance: a question in English runs end to end through BullMQ, the
// real SQL guard, and the real executor against a real database. Only the model is a
// stand-in (tests never call a live model), scripted per test.

const logger = { warn: () => undefined, error: () => undefined } as unknown as Logger;

function proposal(fields: Record<string, unknown>) {
  return {
    text: JSON.stringify({
      status: 'ok',
      sql: '',
      assumptions: [],
      clarifyingQuestion: '',
      explanation: 'Answers the question.',
      ...fields,
    }),
  };
}

describe('question jobs through BullMQ', () => {
  const env = loadEnv({
    ...process.env,
    JOB_QUEUE_NAME: `test-ask-${randomUUID().slice(0, 8)}`,
  });
  const prisma = new PrismaService(env);
  const redis = new RedisService(env);
  const probe = new UserDatabaseProbe(logger, plainClients);
  const connections = new ConnectionService(
    new PrismaConnectionRepository(prisma),
    { lookup: async () => ['127.0.0.1'] },
    probe,
    env,
  );
  const schemas = new SchemaService(
    new PrismaSchemaRepository(prisma),
    connections,
    probe,
  );
  const pools = new ConnectionPools(env, logger, plainPools);
  const model = new FakeLlmProvider('fake-gemini');
  const cancellation = new JobCancellation(redis);
  const processor = new JobProcessor(
    {} as QueryJobRunner,
    {} as ConnectionJobRunner,
    cancellation,
    new AskJobRunner(
      schemas,
      new SqlGuardService(schemas, env),
      connections,
      new QueryExecutor(env, pools, new RedisCoordination(redis), logger),
      new LlmClient([model]),
      new PrismaProposalCache(prisma),
    ),
  );
  const slots = new UserJobSlots(redis);
  const queue = new JobQueue(env, cancellation, slots);
  let worker: RunningJobWorker;
  const userId = randomUUID();
  let db: ScratchDatabase;
  let connectionId: string;

  async function ask(question: string): Promise<JobView> {
    const job = await queue.add('question.ask', { userId, connectionId, question });
    const deadline = Date.now() + 15000;
    for (;;) {
      const current = await queue.get(job.id, userId);
      if (['succeeded', 'failed', 'cancelled'].includes(current.state)) {
        return current;
      }
      if (Date.now() > deadline) {
        throw new Error(`job still ${current.state}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    db = await createScratchDatabase();
    const login = await db.createLogin('ask_reader');
    await db.admin.query(`
      CREATE TABLE public.customers (id int PRIMARY KEY, region text NOT NULL, email text);
      CREATE TABLE public.orders (
        id int PRIMARY KEY,
        customer_id int REFERENCES public.customers (id),
        status text NOT NULL
      );
      INSERT INTO public.customers VALUES (1, 'North', 'a@x'), (2, 'East', 'b@x');
      INSERT INTO public.orders VALUES (1, 1, 'open'), (2, 1, 'open'), (3, 2, 'shipped');
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${login.username};
    `);
    await prisma.user.create({
      data: {
        id: userId,
        googleSubject: `test:${userId}`,
        email: `${userId}@example.test`,
        name: 'Question job test',
        lastLoginAt: new Date(),
      },
    });
    const created = await connections.create(
      userId,
      {
        label: 'Scratch',
        host: 'scratch.example',
        port: db.port,
        databaseName: db.name,
        username: login.username,
        password: login.password,
        sslMode: 'require',
      },
      null,
    );
    connectionId = created.id;
    await schemas.refresh(userId, connectionId, null);
    worker = await startJobWorker({
      env,
      processor,
      slots,
      concurrency: 1,
      hooks: {
        finished: () => undefined,
        crashed: () => undefined,
        sideError: () => undefined,
        error: () => undefined,
      },
    });
  });

  afterAll(async () => {
    await worker.close();
    await queue.onModuleDestroy();
    await pools.onModuleDestroy();
    await redis.onModuleDestroy();
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await db.drop();
  });

  beforeEach(() => {
    model.requests.length = 0;
  });

  /** Model calls that proposed SQL; an answered question also asks for a summary. */
  function sqlCalls() {
    return model.requests.filter((request) => request.purpose === 'sql_proposal');
  }

  it('answers a question with rows from the database', async () => {
    model.script(
      proposal({
        sql: "SELECT c.region, count(*) AS open_orders FROM public.orders o JOIN public.customers c ON c.id = o.customer_id WHERE o.status = 'open' GROUP BY c.region",
        assumptions: ['"Open" means status = open'],
      }),
    );
    const done = await ask('How many open orders does each region have?');
    expect(done).toMatchObject({
      kind: 'question.ask',
      state: 'succeeded',
      result: {
        status: 'answered',
        question: 'How many open orders does each region have?',
        // Customer 1 (North) has the two open orders.
        rows: [['North', '2']],
        rowCount: 1,
        assumptions: ['"Open" means status = open'],
        model: 'fake-gemini',
      },
    });
    // The guard's rewrite is what ran.
    expect((done.result as { sql: string }).sql).toContain('LIMIT 1001');
  });

  it('never shows the model a column hidden by the allowlist', async () => {
    model.script(proposal({ sql: 'SELECT count(*) FROM public.customers' }));
    await ask('How many customers are there?');
    const prompt = model.requests[0]!.prompt;
    expect(prompt).toContain('Table public.customers');
    expect(prompt).toContain('region');
    // email is hidden by the sensitive-column default.
    expect(prompt).not.toContain('email');
  });

  it('corrects a query the real guard rejects, using its reason', async () => {
    model.script(
      proposal({ sql: 'SELECT email FROM public.customers' }),
      proposal({ sql: 'SELECT region FROM public.customers ORDER BY region' }),
    );
    const done = await ask('List the customer regions.');
    expect(done).toMatchObject({
      state: 'succeeded',
      result: { status: 'answered', rows: [['East'], ['North']] },
    });
    expect(sqlCalls()).toHaveLength(2);
    expect(model.requests[1]!.prompt).toContain('SELECT email FROM public.customers');
    expect(model.requests[1]!.prompt).toMatch(/Reason: .*email/);
  });

  it('corrects a query PostgreSQL rejects as invalid, once', async () => {
    model.script(
      proposal({ sql: 'SELECT status, count(*) FROM public.orders' }),
      proposal({
        sql: 'SELECT status, count(*) FROM public.orders GROUP BY status ORDER BY status',
      }),
    );
    const done = await ask('Count orders by status.');
    expect(done).toMatchObject({
      state: 'succeeded',
      result: {
        rows: [
          ['open', '2'],
          ['shipped', '1'],
        ],
      },
    });
  });

  it('stops an ambiguous question before anything runs', async () => {
    model.script(
      proposal({
        status: 'ambiguous',
        clarifyingQuestion: 'Do you mean orders or customers?',
      }),
    );
    const done = await ask('How many are there?');
    expect(done).toMatchObject({
      state: 'succeeded',
      result: {
        status: 'ambiguous',
        clarifyingQuestion: 'Do you mean orders or customers?',
      },
    });
  });

  it('fails with LLM_NOT_CONFIGURED when the model has no key', async () => {
    const { LlmError } = await import('@ayd/core');
    model.script({
      error: new LlmError('misconfigured', 'GEMINI_API_KEY is not set.', 'x'),
    });
    const done = await ask('Anything?');
    expect(done).toMatchObject({
      state: 'failed',
      error: { code: 'LLM_NOT_CONFIGURED' },
    });
  });

  // Runs last: it renames a column in the scratch database.
  it('reuses a cached proposal, then heals once when the database changes, without widening access', async () => {
    model.script(
      proposal({
        sql: 'SELECT status, count(*) AS n FROM public.orders GROUP BY status ORDER BY status',
      }),
    );
    const first = await ask('Orders per status');
    expect(first).toMatchObject({ state: 'succeeded', result: { cached: false } });

    model.requests.length = 0;
    const again = await ask('orders per status?');
    expect(again).toMatchObject({
      state: 'succeeded',
      result: {
        cached: true,
        rows: [
          ['open', '2'],
          ['shipped', '1'],
        ],
      },
    });
    expect(sqlCalls()).toHaveLength(0);

    // The customer renames the column the cached SQL reads.
    await db.admin.query('ALTER TABLE public.orders RENAME COLUMN status TO state');
    model.script(
      proposal({
        status: 'unanswerable',
        explanation: 'The orders table has no status column now.',
      }),
    );
    const healed = await ask('Orders per status');
    expect(healed).toMatchObject({
      state: 'succeeded',
      result: { status: 'unanswerable', schemaRefreshed: true },
    });
    // After the refresh the model saw the new snapshot: the old column is gone, and the
    // renamed one is new, so it stays hidden until the owner allows it.
    const prompt = model.requests.at(-1)!.prompt;
    expect(prompt).toContain('Table public.orders');
    expect(prompt).not.toContain('  status (');
    expect(prompt).not.toContain('  state (');
  });
});
