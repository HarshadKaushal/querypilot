import { ScrollArea, Table, Text, UnstyledButton } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import type { ResultColumn } from '../../../lib/api-types';
import { formatCell, sortRows } from './format';

/** Above this many rows only the visible ones are drawn, so 1,000 rows stay smooth. */
const VIRTUAL_FROM = 100;
const ROW_HEIGHT = 34;

/** The result rows, sortable by clicking a column heading. */
export function ResultTable({
  columns,
  rows,
}: {
  columns: ResultColumn[];
  rows: unknown[][];
}) {
  const [sort, setSort] = useState<{ index: number; direction: 'asc' | 'desc' } | null>(
    null,
  );
  const sorted = useMemo(
    () => (sort ? sortRows(rows, sort.index, sort.direction) : rows),
    [rows, sort],
  );

  if (rows.length === 0) {
    return <Text c="dimmed">The query ran and returned no rows.</Text>;
  }

  function toggle(index: number) {
    setSort((current) =>
      current?.index === index
        ? { index, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { index, direction: 'asc' },
    );
  }

  const head = (
    <Table.Thead
      style={{ position: 'sticky', top: 0, zIndex: 1 }}
      bg="var(--mantine-color-body)"
    >
      <Table.Tr>
        {columns.map((column, index) => (
          <Table.Th
            key={`${column.name}-${index}`}
            aria-sort={
              sort?.index === index
                ? sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none'
            }
          >
            <UnstyledButton onClick={() => toggle(index)} fw={600} fz="sm">
              {column.name}
              {sort?.index === index ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
            </UnstyledButton>
          </Table.Th>
        ))}
      </Table.Tr>
    </Table.Thead>
  );

  return sorted.length > VIRTUAL_FROM ? (
    <VirtualBody columns={columns} rows={sorted} head={head} />
  ) : (
    <ScrollArea type="auto">
      <Table striped highlightOnHover withTableBorder miw={columns.length * 120}>
        {head}
        <Table.Tbody>
          {sorted.map((row, rowIndex) => (
            <Table.Tr key={rowIndex}>
              {columns.map((column, index) => (
                <Cell key={`${column.name}-${index}`} value={row[index]} />
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

function Cell({ value }: { value: unknown }) {
  return (
    <Table.Td style={{ whiteSpace: 'nowrap' }}>
      {value === null || value === undefined ? (
        <Text span c="dimmed" fz="sm">
          null
        </Text>
      ) : (
        formatCell(value)
      )}
    </Table.Td>
  );
}

function VirtualBody({
  columns,
  rows,
  head,
}: {
  columns: ResultColumn[];
  rows: unknown[][];
  head: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  return (
    <div ref={scroller} style={{ maxHeight: 480, overflow: 'auto' }}>
      <Table striped highlightOnHover withTableBorder miw={columns.length * 120}>
        {head}
        <Table.Tbody>
          {before > 0 && (
            <tr>
              <td style={{ height: before }} colSpan={columns.length} />
            </tr>
          )}
          {items.map((item) => (
            <Table.Tr key={item.key} style={{ height: ROW_HEIGHT }}>
              {columns.map((column, index) => (
                <Cell key={`${column.name}-${index}`} value={rows[item.index][index]} />
              ))}
            </Table.Tr>
          ))}
          {after > 0 && (
            <tr>
              <td style={{ height: after }} colSpan={columns.length} />
            </tr>
          )}
        </Table.Tbody>
      </Table>
    </div>
  );
}
