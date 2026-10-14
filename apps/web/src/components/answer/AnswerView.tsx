import {
  Accordion,
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  List,
  Loader,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { lazy, Suspense } from 'react';
import type { AskResult, QueryJobResult, ResultRows } from '../../api/types';
import { ResultTable } from './ResultTable';

// The chart library is most of the app's size, so it loads only when an answer has a chart.
const ResultChart = lazy(() =>
  import('./ResultChart').then((module) => ({ default: module.ResultChart })),
);

/** The answer to a question: ambiguous, unanswerable, or answered with rows. */
export function AnswerView({
  result,
  onRephrase,
}: {
  result: AskResult;
  onRephrase: () => void;
}) {
  if (result.status === 'ambiguous') {
    return (
      <Alert
        color="yellow"
        title="The question can be read more than one way"
        role="status"
      >
        <Text size="sm" fw={500}>
          {result.clarifyingQuestion}
        </Text>
        <Text size="xs" c="dimmed" mt={4}>
          Nothing was run. Add the missing detail to your question and ask again.
        </Text>
        <Button size="xs" mt="sm" variant="white" onClick={onRephrase}>
          Edit the question
        </Button>
      </Alert>
    );
  }
  if (result.status === 'unanswerable') {
    return (
      <Alert
        color="gray"
        title="This can't be answered from the tables you allowed"
        role="status"
      >
        <Text size="sm">{result.explanation}</Text>
        <Text size="xs" c="dimmed" mt={4}>
          Nothing was run. If the data exists, allow its table on the connection page.
        </Text>
      </Alert>
    );
  }
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb={4}>
          <Text size="xs" c="dimmed" tt="uppercase">
            Summary
          </Text>
          {result.summary.source === 'template' && (
            <Badge size="xs" variant="light" color="gray">
              written from the numbers
            </Badge>
          )}
        </Group>
        <Text>{result.summary.text}</Text>
      </Paper>
      {result.chart.type !== 'table' && (
        <Suspense fallback={<Loader size="sm" aria-label="Loading the chart" />}>
          <ResultChart spec={result.chart} />
        </Suspense>
      )}
      <RowsView result={result} />
      <SqlDetails sql={result.sql} assumptions={result.assumptions} />
      <Group gap="xs">
        {result.cached && (
          <Badge variant="light" color="teal">
            answered from a saved query
          </Badge>
        )}
        {result.schemaRefreshed && (
          <Badge variant="light" color="blue">
            schema re-read: your database had changed
          </Badge>
        )}
        {result.usage && (
          <Text size="xs" c="dimmed">
            {(result.usage.totalMs / 1000).toFixed(1)} s ·{' '}
            {(result.usage.inputTokens + result.usage.outputTokens).toLocaleString()}{' '}
            tokens
            {result.usage.models.length > 0 && ` · ${result.usage.models.join(', ')}`}
          </Text>
        )}
      </Group>
    </Stack>
  );
}

/** The result of SQL the user wrote: rows and the SQL that ran, no chart or summary. */
export function QueryResultView({ result }: { result: QueryJobResult }) {
  return (
    <Stack>
      <RowsView result={result} />
      <SqlDetails sql={result.sql} assumptions={[]} />
    </Stack>
  );
}

function RowsView({ result }: { result: ResultRows }) {
  return (
    <Stack gap="xs">
      {result.truncated && (
        <Alert color="blue" role="status">
          {result.truncated === 'rows'
            ? `Showing the first ${result.rowCount.toLocaleString()} rows; there are more. Ask for a narrower result, for example with a filter or a top 10.`
            : 'The result was cut at 5 MB. Ask for fewer columns or rows.'}
        </Alert>
      )}
      <ResultTable columns={result.columns} rows={result.rows} />
      <Text size="xs" c="dimmed">
        {result.rowCount.toLocaleString()} {result.rowCount === 1 ? 'row' : 'rows'} in{' '}
        {result.durationMs} ms
      </Text>
    </Stack>
  );
}

function SqlDetails({ sql, assumptions }: { sql: string; assumptions: string[] }) {
  return (
    <Accordion variant="contained">
      <Accordion.Item value="sql">
        <Accordion.Control>The SQL that ran</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="xs">
            <Code block tabIndex={0} aria-label="The SQL that ran">
              {sql}
            </Code>
            <Group>
              <CopyButton value={sql}>
                {({ copied, copy }) => (
                  <Button size="xs" variant="default" onClick={copy}>
                    {copied ? 'Copied' : 'Copy SQL'}
                  </Button>
                )}
              </CopyButton>
            </Group>
            {assumptions.length > 0 && (
              <>
                <Text size="sm" fw={500}>
                  Assumptions
                </Text>
                <List size="sm">
                  {assumptions.map((assumption) => (
                    <List.Item key={assumption}>{assumption}</List.Item>
                  ))}
                </List>
              </>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
