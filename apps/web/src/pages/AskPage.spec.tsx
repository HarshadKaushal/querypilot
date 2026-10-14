import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type {
  AskResult,
  PublicConnection,
  QueryJobResult,
  SchemaView,
} from '../api/types';
import { eventStream, fakeApi, job, renderWithApp } from '../test/render';
import { AskPage } from './AskPage';

const CONNECTION: PublicConnection = {
  id: 'c1',
  label: 'Sample shop',
  host: '127.0.0.1',
  port: 5433,
  databaseName: 'sample',
  sslMode: 'require',
  status: 'active',
  lastTestedAt: null,
  sendSampleRowsToLlm: false,
  keyVersion: 1,
};

const SCHEMA: SchemaView = {
  connectionId: 'c1',
  version: 1,
  tables: [
    {
      schema: 'public',
      name: 'orders',
      kind: 'table',
      columns: [{ name: 'id', type: 'integer', nullable: false }],
      foreignKeys: [],
    },
  ],
};

const COMMON = {
  question: 'How many orders per region?',
  explanation: '',
  schemaVersion: 1,
  model: 'gemini-3.8-flash',
  cached: false,
  schemaRefreshed: false,
};

const ANSWERED: AskResult = {
  ...COMMON,
  status: 'answered',
  sql: 'SELECT region, count(*) FROM public.orders GROUP BY region LIMIT 1001',
  assumptions: ['Orders of every status are counted.'],
  chart: { type: 'table' },
  summary: { text: 'North has 2 orders and South has 1.', source: 'model' },
  columns: [
    { name: 'region', dataTypeId: 25 },
    { name: 'count', dataTypeId: 20 },
  ],
  rows: [
    ['North', '2'],
    ['South', '1'],
  ],
  rowCount: 2,
  truncated: false,
  durationMs: 12,
  usage: {
    llmCalls: 2,
    inputTokens: 900,
    outputTokens: 60,
    llmMs: 800,
    queryMs: 12,
    totalMs: 1200,
    models: ['gemini-3.8-flash'],
    fallbackUsed: false,
  },
};

function api(overrides: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    get: vi.fn(async (path: string) =>
      path.endsWith('/schema') ? SCHEMA : [CONNECTION],
    ),
    post: vi.fn().mockResolvedValue(job({ kind: 'question.ask' })),
    ...overrides,
  });
}

function finished(result: unknown) {
  return vi
    .fn()
    .mockResolvedValue(
      eventStream(
        job({ kind: 'question.ask', state: 'running', stage: 'generating_sql' }),
        job({ kind: 'question.ask', state: 'succeeded', result }),
      ),
    );
}

async function ask(question = 'How many orders per region?') {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Your question'), question);
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  return user;
}

describe('AskPage', () => {
  it('asks the question and shows the summary, the rows, and the SQL', async () => {
    const client = api({ stream: finished(ANSWERED) });
    renderWithApp(<AskPage />, { api: client });
    const user = await ask();
    expect(
      await screen.findByText('North has 2 orders and South has 1.'),
    ).toBeInTheDocument();
    expect(client.post).toHaveBeenCalledWith('/v1/connections/c1/questions', {
      question: 'How many orders per region?',
    });
    const table = screen.getByRole('table');
    expect(within(table).getByText('North')).toBeInTheDocument();
    expect(screen.getByText('2 rows in 12 ms')).toBeInTheDocument();
    await user.click(screen.getByText('The SQL that ran'));
    expect(screen.getByText(ANSWERED.sql)).toBeInTheDocument();
    expect(screen.getByText('Orders of every status are counted.')).toBeInTheDocument();
  });

  it('sorts the table when a column heading is clicked', async () => {
    renderWithApp(<AskPage />, { api: api({ stream: finished(ANSWERED) }) });
    const user = await ask();
    const heading = await screen.findByRole('button', { name: 'count' });
    await user.click(heading);
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells).toEqual(['South', '1', 'North', '2']);
  });

  it('suggests example questions from the allowed tables', async () => {
    renderWithApp(<AskPage />, { api: api() });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'How many orders are there?' }),
    );
    expect(screen.getByLabelText('Your question')).toHaveValue(
      'How many orders are there?',
    );
  });

  it('shows the clarifying question for an ambiguous question, and says nothing ran', async () => {
    const ambiguous: AskResult = {
      ...COMMON,
      status: 'ambiguous',
      clarifyingQuestion: 'Do you mean orders placed or orders shipped?',
      assumptions: [],
    };
    renderWithApp(<AskPage />, { api: api({ stream: finished(ambiguous) }) });
    await ask();
    expect(
      await screen.findByText('Do you mean orders placed or orders shipped?'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing was run/)).toBeInTheDocument();
  });

  it('explains a question the allowed tables cannot answer', async () => {
    const unanswerable: AskResult = {
      ...COMMON,
      status: 'unanswerable',
      explanation: 'There is no table about employees.',
    };
    renderWithApp(<AskPage />, { api: api({ stream: finished(unanswerable) }) });
    await ask();
    expect(
      await screen.findByText('There is no table about employees.'),
    ).toBeInTheDocument();
  });

  it('shows a query refused for safety, with the check that refused it', async () => {
    const stream = vi.fn().mockResolvedValue(
      eventStream(
        job({
          kind: 'question.ask',
          state: 'failed',
          error: {
            code: 'SQL_REJECTED',
            message:
              'The assistant could not write a query that passes the safety checks.',
            retryable: false,
            detail: { guardCode: 'writes_data' },
          },
        }),
      ),
    );
    renderWithApp(<AskPage />, { api: api({ stream }) });
    await ask('Delete every order');
    expect(
      await screen.findByText('Not run: the query did not pass the safety checks'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Safety check: writes_data. Nothing ran/),
    ).toBeInTheDocument();
  });

  it('says when the daily limit is reached, and when to try again', async () => {
    const post = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          429,
          'QUOTA_EXCEEDED',
          'You have asked 50 questions today.',
          'r1',
          7200,
        ),
      );
    renderWithApp(<AskPage />, { api: api({ post }) });
    await ask();
    expect(await screen.findByText('Daily limit reached')).toBeInTheDocument();
    expect(screen.getByText('You can try again in about 2 hours.')).toBeInTheDocument();
  });

  it('runs SQL the user wrote and shows its rows', async () => {
    const result: QueryJobResult = {
      columns: [{ name: 'n', dataTypeId: 20 }],
      rows: [['42']],
      rowCount: 1,
      truncated: 'rows',
      durationMs: 5,
      sql: 'SELECT count(*) AS n FROM public.orders LIMIT 1001',
      schemaVersion: 1,
    };
    const client = api({
      post: vi.fn().mockResolvedValue(job({ kind: 'query.run' })),
      stream: vi
        .fn()
        .mockResolvedValue(
          eventStream(job({ kind: 'query.run', state: 'succeeded', result })),
        ),
    });
    renderWithApp(<AskPage />, { api: client });
    const user = userEvent.setup();
    await user.click(await screen.findByText('SQL'));
    await user.type(
      screen.getByLabelText(/Your SQL/),
      'SELECT count(*) AS n FROM orders',
    );
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(client.post).toHaveBeenCalledWith('/v1/connections/c1/queries', {
      sql: 'SELECT count(*) AS n FROM orders',
    });
    expect(
      screen.getByText(/Showing the first 1 rows; there are more/),
    ).toBeInTheDocument();
  });

  it('cancels a running question', async () => {
    let finish: (value: Response) => void = () => undefined;
    const stream = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const post = vi
      .fn()
      .mockResolvedValueOnce(
        job({ kind: 'question.ask', state: 'running', stage: 'generating_sql' }),
      )
      .mockResolvedValueOnce({});
    renderWithApp(<AskPage />, { api: api({ post, stream }) });
    const user = await ask();
    expect(await screen.findByText('Writing the query')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(post).toHaveBeenLastCalledWith('/v1/jobs/j1/cancel');
    finish(
      eventStream(
        job({
          kind: 'question.ask',
          state: 'cancelled',
          error: {
            code: 'JOB_CANCELLED',
            message: 'The job was cancelled.',
            retryable: true,
          },
        }),
      ),
    );
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });

  it('asks the user to connect a database first when there is none', async () => {
    renderWithApp(<AskPage />, { api: fakeApi({ get: vi.fn().mockResolvedValue([]) }) });
    expect(
      await screen.findByRole('link', { name: 'Connect a database' }),
    ).toHaveAttribute('href', '/connections/new');
  });
});
