import {
  Alert,
  Anchor,
  Button,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorAlert } from '../../components/ErrorAlert';
import { JobProgress } from '../../components/JobProgress';
import { ApiError } from '../../lib/api-client';
import type { AskResult, QueryJobResult } from '../../lib/api-types';
import { cancelJob } from '../../lib/jobs';
import { queryKeys } from '../../lib/query-keys';
import { useJobRunner } from '../../lib/use-job-runner';
import { useAuth } from '../auth';
import { useConnections } from '../connections';
import { askQuestion, runSql, useSchema } from './api';
import { AnswerView, QueryResultView } from './components/AnswerView';
import { FailureView } from './components/FailureView';
import { examplesFor } from './examples';

// The API's limits (jobs.controller.ts), checked here first so the user sees why at once.
const MAX_QUESTION = 2000;
const MAX_SQL = 20000;

type Mode = 'question' | 'sql';

type Outcome =
  | { kind: 'question'; result: AskResult }
  | { kind: 'sql'; result: QueryJobResult }
  /** A JobError from a failed job, or an ApiError from a refused request. */
  | { kind: 'error'; error: unknown };

/**
 * Ask a question in English, or run SQL you wrote (blueprint 8.3). Either way a worker job
 * checks the SQL with the guard and runs it read-only; the page follows the job live and
 * shows the answer, or why there is none.
 */
export function AskPage() {
  const { api } = useAuth();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>('question');
  const queryClient = useQueryClient();
  // "Ask again" from History opens this page with the question filled in.
  const [text, setText] = useState(() => params.get('q') ?? '');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const job = useJobRunner();
  const running = job.progress;
  // Sent, but the first progress update has not arrived yet.
  const starting = job.busy && running === null;

  const connections = useConnections();
  const connectionId = params.get('connection') ?? connections.data?.[0]?.id ?? null;
  const schema = useSchema(connectionId);

  const limit = mode === 'question' ? MAX_QUESTION : MAX_SQL;
  const trimmed = text.trim();
  const tooLong = text.length > limit;
  const busy = job.busy;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!connectionId || trimmed === '' || tooLong || busy) {
      return;
    }
    setOutcome(null);
    if (mode === 'question') {
      const ended = await job.run((options) =>
        askQuestion(api, connectionId, trimmed, options),
      );
      if (ended) {
        setOutcome(
          ended.ok
            ? { kind: 'question', result: ended.result }
            : { kind: 'error', error: ended.error },
        );
      }
    } else {
      const ended = await job.run((options) =>
        runSql(api, connectionId, trimmed, options),
      );
      if (ended) {
        setOutcome(
          ended.ok
            ? { kind: 'sql', result: ended.result }
            : { kind: 'error', error: ended.error },
        );
      }
    }
    // A finished job is a new history entry, and may have used a question.
    void queryClient.invalidateQueries({ queryKey: queryKeys.history });
    void queryClient.invalidateQueries({ queryKey: queryKeys.usage });
  }

  async function cancel() {
    if (running) {
      // The followed job then ends as cancelled, which shows below.
      await cancelJob(api, running.id).catch(() => undefined);
    }
  }

  if (connections.isPending) {
    return <Loader aria-label="Loading connections" />;
  }
  if (connections.isError) {
    return (
      <ErrorAlert error={connections.error} title="Could not load your connections" />
    );
  }
  if (connections.data.length === 0) {
    return (
      <Stack maw={640}>
        <Title order={2}>Ask a question</Title>
        <Text>Connect a database first, then ask about its data in plain English.</Text>
        <Group>
          <Button component={Link} to="/connections/new">
            Connect a database
          </Button>
        </Group>
      </Stack>
    );
  }

  const examples = schema.data ? examplesFor(schema.data) : [];
  const schemaMissing =
    schema.error instanceof ApiError && schema.error.code === 'SCHEMA_NOT_READY';

  return (
    <Stack maw={1100}>
      <Title order={2}>Ask a question</Title>
      <form onSubmit={submit}>
        <Stack gap="sm">
          <Group align="flex-end" wrap="wrap">
            <Select
              label="Database"
              data={connections.data.map((c) => ({ value: c.id, label: c.label }))}
              value={connectionId}
              onChange={(value) => {
                if (value) {
                  setParams({ connection: value });
                  setOutcome(null);
                }
              }}
              allowDeselect={false}
              disabled={busy}
              w={260}
            />
            <SegmentedControl
              value={mode}
              onChange={(value) => {
                setMode(value as Mode);
                setOutcome(null);
              }}
              data={[
                { value: 'question', label: 'Question' },
                { value: 'sql', label: 'SQL' },
              ]}
              disabled={busy}
            />
          </Group>
          <Textarea
            ref={input}
            label={
              mode === 'question'
                ? 'Your question'
                : 'Your SQL (read-only, checked before it runs)'
            }
            placeholder={
              mode === 'question'
                ? 'For example: Which five products sold the most last month?'
                : 'SELECT ...'
            }
            autosize
            minRows={mode === 'question' ? 2 : 5}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                void submit();
              }
            }}
            error={
              tooLong ? `Use at most ${limit.toLocaleString()} characters.` : undefined
            }
            disabled={busy}
            styles={mode === 'sql' ? { input: { fontFamily: 'monospace' } } : undefined}
          />
          {mode === 'question' && examples.length > 0 && !busy && (
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                Try:
              </Text>
              {examples.map((example) => (
                <Button
                  key={example}
                  size="compact-xs"
                  variant="light"
                  onClick={() => setText(example)}
                >
                  {example}
                </Button>
              ))}
            </Group>
          )}
          {schemaMissing && (
            <Alert color="yellow" title="Choose what the AI can see first">
              <Text size="sm">The schema for this database has not been read yet.</Text>
              <Anchor component={Link} to={`/connections/${connectionId}`} size="sm">
                Open the connection
              </Anchor>
            </Alert>
          )}
          <Group>
            <Button
              type="submit"
              loading={starting}
              disabled={trimmed === '' || tooLong || running !== null}
            >
              {mode === 'question' ? 'Ask' : 'Run'}
            </Button>
            {running && (
              <Button
                variant="default"
                onClick={() => void cancel()}
                disabled={running.cancelRequested}
              >
                {running.cancelRequested ? 'Cancelling…' : 'Cancel'}
              </Button>
            )}
          </Group>
        </Stack>
      </form>

      {running && (
        <JobProgress
          view={running}
          label={mode === 'question' ? 'Answering' : 'Running the query'}
        />
      )}
      {outcome?.kind === 'question' && (
        <AnswerView result={outcome.result} onRephrase={() => input.current?.focus()} />
      )}
      {outcome?.kind === 'sql' && <QueryResultView result={outcome.result} />}
      {outcome?.kind === 'error' && connectionId && (
        <FailureView error={outcome.error} connectionId={connectionId} />
      )}
    </Stack>
  );
}
