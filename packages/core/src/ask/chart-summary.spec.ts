import { downsample, selectChart } from './chart';
import { computeFacts } from './facts';
import { buildSummaryPrompt, summaryIsGrounded, templateSummary } from './summary';

const TEXT = 25;
const INT8 = 20;
const NUMERIC = 1700;
const DATE = 1082;

const col = (name: string, dataTypeId: number) => ({ name, dataTypeId });

describe('selectChart', () => {
  it('shows a single number as a stat card', () => {
    expect(selectChart({ columns: [col('n', INT8)], rows: [['42']] })).toMatchObject({
      type: 'stat',
      x: 'n',
    });
  });

  it('draws a date then numbers as a line', () => {
    const rows = [
      ['2026-01-01', '3'],
      ['2026-02-01', '5'],
    ];
    expect(
      selectChart({ columns: [col('month', DATE), col('orders', INT8)], rows }),
    ).toEqual({ type: 'line', x: 'month', y: ['orders'], points: rows });
  });

  it('draws 2 to 5 non-negative shares as a pie, and more as bars', () => {
    const columns = [col('region', TEXT), col('n', INT8)];
    const few = [
      ['North', '2'],
      ['East', '1'],
    ];
    expect(selectChart({ columns, rows: few }).type).toBe('pie');
    const many = Array.from({ length: 8 }, (_, i) => [`R${i}`, String(i)]);
    expect(selectChart({ columns, rows: many }).type).toBe('bar');
    expect(
      selectChart({ columns, rows: [...few.slice(0, 1), ['West', '-3']] }).type,
    ).toBe('bar');
  });

  it('falls back to the table for shapes it cannot chart', () => {
    expect(
      selectChart({ columns: [col('a', TEXT), col('b', TEXT)], rows: [['x', 'y']] }).type,
    ).toBe('table');
    expect(selectChart({ columns: [col('n', INT8)], rows: [] }).type).toBe('table');
    const tooMany = Array.from({ length: 51 }, (_, i) => [`R${i}`, String(i)]);
    expect(
      selectChart({ columns: [col('r', TEXT), col('n', INT8)], rows: tooMany }).type,
    ).toBe('table');
  });

  it('thins a long line to 200 points, keeping the first and last', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => [`d${i}`, String(i)]);
    const chart = selectChart({ columns: [col('day', DATE), col('n', INT8)], rows });
    expect(chart.points).toHaveLength(200);
    expect(chart.downsampled).toBe(true);
    expect(chart.points?.[0]).toEqual(rows[0]);
    expect(chart.points?.at(-1)).toEqual(rows.at(-1));
    expect(downsample(rows.slice(0, 10))).toHaveLength(10);
  });
});

describe('computeFacts', () => {
  it('computes min, max, total, average, and the top items from string numbers', () => {
    const facts = computeFacts(
      {
        columns: [col('region', TEXT), col('revenue', NUMERIC)],
        rows: [
          ['North', '120.50'],
          ['East', '80'],
          ['West', null],
        ],
        rowCount: 3,
        truncated: false,
      },
      { labels: true },
    );
    expect(facts).toEqual({
      rowCount: 3,
      truncated: false,
      columns: ['region', 'revenue'],
      numeric: [
        { column: 'revenue', min: 80, max: 120.5, total: 200.5, average: 100.25 },
      ],
      top: [
        { label: 'North', value: 120.5 },
        { label: 'East', value: 80 },
      ],
    });
  });
});

describe('summaries', () => {
  const facts = computeFacts(
    {
      columns: [col('region', TEXT), col('n', INT8)],
      rows: [
        ['North', '2'],
        ['East', '1'],
      ],
      rowCount: 2,
      truncated: false,
    },
    { labels: true },
  );

  it('accepts a summary whose numbers all come from the facts or the rows shown', () => {
    expect(
      summaryIsGrounded(
        'North has 2 open orders and East has 1; 3 in total.',
        facts,
        null,
        'q',
      ),
    ).toBe(true);
  });

  it('rejects a summary with a number that is not in the data', () => {
    expect(summaryIsGrounded('North has 7 open orders.', facts, null, 'q')).toBe(false);
  });

  it('allows numbers from the question and from rows that were shown', () => {
    expect(
      summaryIsGrounded(
        'The top 5 regions are listed.',
        facts,
        null,
        'Show the top 5 regions',
      ),
    ).toBe(true);
    expect(
      summaryIsGrounded('The first order was 2026.', facts, [['2026-01-01']], 'q'),
    ).toBe(true);
  });

  it('shows rows to the model only when a sample is passed', () => {
    const withRows = buildSummaryPrompt({
      question: 'q',
      facts,
      sample: [['North', '2']],
    });
    expect(withRows).toContain('[["North","2"]]');
    const without = buildSummaryPrompt({ question: 'q', facts, sample: null });
    expect(without).toContain('No rows are shown');
    // The facts still carry the top labels and totals the server computed.
    expect(without).toContain('"total":3');
  });

  it('writes a template from the facts, mentioning a cut result', () => {
    expect(templateSummary(facts)).toBe(
      'The query returned 2 rows. The largest value is 2 for North.',
    );
    expect(templateSummary({ ...facts, rowCount: 0 })).toBe(
      'No rows matched the question.',
    );
    expect(templateSummary({ ...facts, truncated: 'rows' })).toContain(
      'only part of the data',
    );
  });
});

describe('labels without permission', () => {
  it('keeps row values out of the facts, and so out of the template', () => {
    const facts = computeFacts(
      {
        columns: [col('region', TEXT), col('n', INT8)],
        rows: [
          ['North', '2'],
          ['East', '1'],
        ],
        rowCount: 2,
        truncated: false,
      },
      { labels: false },
    );
    expect(facts.top).toEqual([]);
    expect(JSON.stringify(facts)).not.toContain('North');
    expect(templateSummary(facts)).toBe(
      'The query returned 2 rows. n ranges from 1 to 2, with a total of 3.',
    );
    expect(buildSummaryPrompt({ question: 'q', facts, sample: null })).not.toContain(
      'North',
    );
  });
});
