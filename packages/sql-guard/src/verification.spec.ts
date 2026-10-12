import { deparseSync } from 'pgsql-deparser';
import { checkSql } from './guard';
import { ROW_CAP, TABLES } from './__fixtures__/tables';

// The deparser is not PostgreSQL's own code, so the guard parses its output again and checks
// it again. These tests stand in for a faulty deparser to show that safety net works.
jest.mock('pgsql-deparser', () => {
  const actual = jest.requireActual<typeof import('pgsql-deparser')>('pgsql-deparser');
  return { ...actual, deparseSync: jest.fn(actual.deparseSync) };
});

const deparse = deparseSync as jest.MockedFunction<typeof deparseSync>;
const options = { tables: TABLES, rowCap: ROW_CAP };

describe('verification of the rewritten SQL', () => {
  it('rejects output that would read a hidden column', async () => {
    deparse.mockReturnValueOnce(
      'SELECT customers.email FROM public.customers LIMIT 1000',
    );
    await expect(checkSql('SELECT name FROM customers', options)).resolves.toMatchObject({
      ok: false,
      code: 'verification_failed',
      reason: expect.stringContaining('public.customers.email'),
    });
  });

  it('rejects output that does not come back unchanged', async () => {
    deparse
      .mockReturnValueOnce('SELECT customers.name FROM public.customers LIMIT 1000')
      .mockReturnValueOnce('SELECT customers.name FROM public.customers LIMIT 999');
    await expect(checkSql('SELECT name FROM customers', options)).resolves.toMatchObject({
      ok: false,
      code: 'verification_failed',
    });
  });

  it('lets an unexpected failure surface instead of calling it a rejection', async () => {
    deparse.mockImplementationOnce(() => {
      throw new Error('deparser crashed');
    });
    await expect(checkSql('SELECT 1', options)).rejects.toThrow('deparser crashed');
  });
});
