import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryEntry, QueryJobResult } from '../../lib/api-types';
import { eventStream, fakeApi, job, renderWithApp } from '../../test/render';
import { HistoryPage } from './HistoryPage';

function entry(fields: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: 'h1',
    connectionId: 'c1',
    kind: 'question',
    question: 'How many orders per region?',
    sql: 'SELECT region, count(*) FROM public.orders GROUP BY region LIMIT 1001',
    status: 'answered',
    errorCode: null,
    rowCount: 4,
    truncated: null,
    schemaVersion: 1,
    cached: false,
    summary: 'There are 4 regions.',
    models: ['gemini-3.8-flash'],
    inputTokens: 900,
    outputTokens: 60,
    llmMs: 800,
    queryMs: 12,
    totalMs: 1200,
    createdAt: '2026-10-14T10:00:00.000Z',
    finishedAt: '2026-10-14T10:00:01.000Z',
    ...fields,
  };
}

const CONNECTIONS = [{ id: 'c1', label: 'Sample shop' }];

function routedGet(pages: Record<string, unknown>) {
  return vi.fn(async (path: string) => {
    if (path === '/v1/connections') return CONNECTIONS;
    const page = pages[path];
    if (!page) throw new Error(`unexpected ${path}`);
    return page;
  });
}

describe('HistoryPage', () => {
  it('lists entries with their status and connection, and loads older ones', async () => {
    const get = routedGet({
      '/v1/history?limit=20': { entries: [entry({})], nextCursor: 'abc' },
      '/v1/history?limit=20&cursor=abc': {
        entries: [
          entry({
            id: 'h2',
            kind: 'sql',
            question: null,
            sql: 'DELETE FROM orders',
            status: 'failed',
            errorCode: 'SQL_REJECTED',
            rowCount: null,
            summary: null,
          }),
        ],
        nextCursor: null,
      },
    });
    renderWithApp(<HistoryPage />, { api: fakeApi({ get }) });
    expect(await screen.findByText('How many orders per region?')).toBeInTheDocument();
    expect(screen.getByText('Answered')).toBeInTheDocument();
    expect(screen.getByText(/Sample shop · 4 rows/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load older' }));
    expect(await screen.findByText('DELETE FROM orders')).toBeInTheDocument();
    expect(screen.getByText('Code: SQL_REJECTED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument();
  });

  it('says so when there is no history yet', async () => {
    const get = routedGet({ '/v1/history?limit=20': { entries: [], nextCursor: null } });
    renderWithApp(<HistoryPage />, { api: fakeApi({ get }) });
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
  });

  it('runs the stored SQL again and shows the fresh rows', async () => {
    const result: QueryJobResult = {
      columns: [{ name: 'region', dataTypeId: 25 }],
      rows: [['North']],
      rowCount: 1,
      truncated: false,
      durationMs: 3,
      sql: 'SELECT region FROM public.orders LIMIT 1001',
      schemaVersion: 1,
    };
    const api = fakeApi({
      get: routedGet({
        '/v1/history?limit=20': { entries: [entry({})], nextCursor: null },
      }),
      post: vi.fn().mockResolvedValue(job({ kind: 'query.run' })),
      stream: vi
        .fn()
        .mockResolvedValue(
          eventStream(job({ kind: 'query.run', state: 'succeeded', result })),
        ),
    });
    renderWithApp(<HistoryPage />, { api });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Run again' }));
    expect(api.post).toHaveBeenCalledWith('/v1/history/h1/rerun', undefined);
    expect(await screen.findByText('North')).toBeInTheDocument();
  });

  it('links a question to the ask page with the question filled in', async () => {
    renderWithApp(<HistoryPage />, {
      api: fakeApi({
        get: routedGet({
          '/v1/history?limit=20': { entries: [entry({})], nextCursor: null },
        }),
      }),
    });
    expect(await screen.findByRole('link', { name: 'Ask again' })).toHaveAttribute(
      'href',
      '/ask?connection=c1&q=How%20many%20orders%20per%20region%3F',
    );
  });

  it('deletes one entry, and clears all after confirming', async () => {
    const api = fakeApi({
      get: routedGet({
        '/v1/history?limit=20': { entries: [entry({})], nextCursor: null },
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    });
    renderWithApp(<HistoryPage />, { api });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete this entry' }));
    expect(api.delete).toHaveBeenCalledWith('/v1/history/h1');
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Clear all' }));
    expect(api.delete).toHaveBeenLastCalledWith('/v1/history');
  });
});
