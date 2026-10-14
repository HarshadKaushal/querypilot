import { BarChart, LineChart, PieChart } from '@mantine/charts';
import { Paper, Stack, Text } from '@mantine/core';
import type { ChartSpec } from '../../api/types';
import { formatCell, toNumber } from './format';

const COLORS = ['blue.6', 'teal.6', 'orange.6', 'grape.6', 'red.6', 'cyan.6'];

/** Turns the chart's rows into the objects the chart library draws. Exported for tests. */
export function chartData(spec: ChartSpec): Array<Record<string, string | number>> {
  const x = spec.x ?? '';
  const y = spec.y ?? [];
  return (spec.points ?? []).map((row) => {
    const point: Record<string, string | number> = { [x]: formatCell(row[0]) };
    y.forEach((name, index) => {
      point[name] = toNumber(row[index + 1]) ?? 0;
    });
    return point;
  });
}

/**
 * Draws the chart the server chose (a stat, a line over time, bars, or a pie). The table is
 * always shown as well, so a 'table' choice draws nothing here.
 */
export function ResultChart({ spec }: { spec: ChartSpec }) {
  if (spec.type === 'table' || !spec.points?.length || !spec.x) {
    return null;
  }
  if (spec.type === 'stat') {
    const value = spec.points[0]?.[0];
    const number = toNumber(value);
    return (
      <Paper withBorder p="md" radius="md" maw={320}>
        <Text size="xs" c="dimmed" tt="uppercase">
          {spec.x}
        </Text>
        <Text fz={36} fw={700}>
          {number !== null ? number.toLocaleString() : formatCell(value)}
        </Text>
      </Paper>
    );
  }
  const data = chartData(spec);
  const series = (spec.y ?? []).map((name, index) => ({
    name,
    color: COLORS[index % COLORS.length],
  }));
  const label = `Chart of ${(spec.y ?? []).join(', ')} by ${spec.x}`;
  return (
    <Stack gap={4} role="img" aria-label={label}>
      {spec.type === 'line' && (
        <LineChart
          h={280}
          data={data}
          dataKey={spec.x}
          series={series}
          curveType="linear"
        />
      )}
      {spec.type === 'bar' && (
        <BarChart h={280} data={data} dataKey={spec.x} series={series} />
      )}
      {spec.type === 'pie' && (
        <PieChart
          h={260}
          withLabels
          withTooltip
          labelsType="percent"
          data={data.map((point, index) => ({
            name: String(point[spec.x!]),
            value: Number(point[series[0]?.name ?? '']) || 0,
            color: COLORS[index % COLORS.length],
          }))}
        />
      )}
      {spec.downsampled && (
        <Text size="xs" c="dimmed">
          The line shows 200 evenly spaced points; the table has every row.
        </Text>
      )}
    </Stack>
  );
}
