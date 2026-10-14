import {
  Alert,
  Button,
  Checkbox,
  Code,
  CopyButton,
  Group,
  Loader,
  NumberInput,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { runJob } from '../api/jobs';
import type {
  ConnectionInput,
  EgressInfo,
  JobError,
  JobView,
  PublicConnection,
  RefreshSummary,
} from '../api/types';
import { isAbort, useUnmountSignal } from '../api/use-abort';
import { useAuth } from '../auth/auth-context';
import { AllowlistSection } from '../components/AllowlistSection';
import { ErrorAlert } from '../components/ErrorAlert';
import { JobProgress } from '../components/JobProgress';
import { CONNECTIONS_KEY } from './ConnectionsPage';

export type ConnectionForm = Omit<ConnectionInput, 'port'> & { port: number | string };

const EMPTY_FORM: ConnectionForm = {
  label: '',
  host: '',
  port: 5432,
  databaseName: '',
  username: '',
  password: '',
  sslMode: 'require',
  sendSampleRowsToLlm: false,
};

type FieldErrors = Partial<Record<keyof ConnectionForm, string>>;

/** The same limits the API checks (connection.service.ts), so mistakes show per field. */
export function validateConnection(form: ConnectionForm): FieldErrors {
  const errors: FieldErrors = {};
  const length = (
    value: string,
    max: number,
    field: keyof ConnectionForm,
    name: string,
  ) => {
    if (value.length === 0) {
      errors[field] = `Enter the ${name}.`;
    } else if (value.length > max) {
      errors[field] = `Use at most ${max} characters.`;
    }
  };
  length(form.label.trim(), 80, 'label', 'name for this connection');
  length(form.host.trim(), 253, 'host', 'host');
  length(form.databaseName.trim(), 63, 'databaseName', 'database name');
  length(form.username, 128, 'username', 'username');
  length(form.password, 256, 'password', 'password');
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.port = 'Enter a port from 1 to 65535.';
  }
  return errors;
}

/**
 * Connect a database (blueprint 8.2): prepare it, enter the login, then choose what the AI
 * may see. Saving runs in the worker, which refuses a login that can do more than read.
 */
export function ConnectWizardPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signal = useUnmountSignal();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ConnectionForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [progress, setProgress] = useState<{
    label: string;
    view: JobView | null;
  } | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<RefreshSummary | null>(null);
  const [readError, setReadError] = useState<JobError | null>(null);

  const egress = useQuery({
    queryKey: ['egress'],
    queryFn: ({ signal: querySignal }) =>
      api.get<EgressInfo>('/v1/meta/egress', querySignal),
  });

  function update<K extends keyof ConnectionForm>(field: K, value: ConnectionForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems = validateConnection(form);
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      return;
    }
    setFailure(null);
    try {
      setProgress({ label: 'Saving the connection', view: null });
      const created = await runJob<PublicConnection>(
        api,
        '/v1/connections',
        {
          ...form,
          port: Number(form.port),
          label: form.label.trim(),
          host: form.host.trim(),
        },
        {
          signal: signal(),
          onUpdate: (view) => setProgress({ label: 'Saving the connection', view }),
        },
      );
      if (created.state !== 'succeeded' || !created.result) {
        setFailure(created.error ?? null);
        return;
      }
      // Saved: the password is not kept in the page any longer than needed.
      const id = created.result.id;
      setForm((current) => ({ ...current, password: '' }));
      setConnectionId(id);
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
      const read = await runJob<RefreshSummary>(
        api,
        `/v1/connections/${id}/schema/refresh`,
        undefined,
        {
          signal: signal(),
          onUpdate: (view) => setProgress({ label: 'Reading the schema', view }),
        },
      );
      if (read.state === 'succeeded' && read.result) {
        setSummary(read.result);
      } else {
        // The connection is saved; the next step offers to read the schema again.
        setReadError(read.error ?? null);
      }
      setStep(2);
    } catch (error) {
      if (!isAbort(error)) {
        setFailure(error);
      }
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;

  return (
    <Stack maw={900}>
      <Title order={2}>Connect a database</Title>
      <Stepper active={step} size="sm">
        <Stepper.Step label="Prepare" description="Firewall and read-only login">
          <Stack mt="md">
            {egress.isPending && <Loader aria-label="Loading setup instructions" />}
            {egress.isError && (
              <ErrorAlert error={egress.error} title="Could not load the setup steps" />
            )}
            {egress.data && (
              <>
                <Text size="sm">
                  1. {egress.data.firewall}{' '}
                  {egress.data.egressIp ? (
                    <>
                      This platform connects from <Code>{egress.data.egressIp}</Code>.
                    </>
                  ) : (
                    'This server has no fixed outgoing address set (normal in local development).'
                  )}
                </Text>
                <Text size="sm">
                  2. As an admin, create a login that can only read, and fill in the
                  placeholders in angle brackets. The platform refuses a login that can
                  change data or create tables.
                </Text>
                <Code block>{egress.data.setupSql}</Code>
                <Group>
                  <CopyButton value={egress.data.setupSql}>
                    {({ copied, copy }) => (
                      <Button variant="default" size="xs" onClick={copy}>
                        {copied ? 'Copied' : 'Copy SQL'}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
              </>
            )}
            <Group justify="flex-end">
              <Button onClick={() => setStep(1)}>Next</Button>
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Connect" description="Address and login">
          <form onSubmit={submit} noValidate>
            <Stack mt="md">
              <TextInput
                label="Name"
                description="Only for you, for example Sales database"
                value={form.label}
                onChange={(e) => update('label', e.currentTarget.value)}
                error={errors.label}
                disabled={busy}
              />
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <TextInput
                  label="Host"
                  placeholder="db.example.com"
                  value={form.host}
                  onChange={(e) => update('host', e.currentTarget.value)}
                  error={errors.host}
                  disabled={busy}
                  style={{ gridColumn: 'span 2' }}
                />
                <NumberInput
                  label="Port"
                  value={form.port}
                  onChange={(value) => update('port', value)}
                  error={errors.port}
                  disabled={busy}
                  hideControls
                />
              </SimpleGrid>
              <TextInput
                label="Database"
                value={form.databaseName}
                onChange={(e) => update('databaseName', e.currentTarget.value)}
                error={errors.databaseName}
                disabled={busy}
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label="Username"
                  autoComplete="off"
                  value={form.username}
                  onChange={(e) => update('username', e.currentTarget.value)}
                  error={errors.username}
                  disabled={busy}
                />
                <PasswordInput
                  label="Password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => update('password', e.currentTarget.value)}
                  error={errors.password}
                  disabled={busy}
                />
              </SimpleGrid>
              <Select
                label="SSL"
                description="Plain, unencrypted connections are not allowed."
                data={[
                  { value: 'require', label: 'Require (encrypted)' },
                  {
                    value: 'verify-full',
                    label: 'Verify full (encrypted, certificate checked)',
                  },
                ]}
                value={form.sslMode}
                onChange={(value) =>
                  update('sslMode', (value ?? 'require') as ConnectionForm['sslMode'])
                }
                allowDeselect={false}
                disabled={busy}
              />
              <Checkbox
                label="Let the AI see up to 20 result rows when it writes the summary"
                description="Off: it sees only column names, the row count, and numeric totals."
                checked={form.sendSampleRowsToLlm}
                onChange={(e) => update('sendSampleRowsToLlm', e.currentTarget.checked)}
                disabled={busy}
              />
              {failure !== null && (
                <ErrorAlert error={failure} title="The connection was not saved" />
              )}
              {progress && <JobProgress view={progress.view} label={progress.label} />}
              <Group justify="space-between">
                <Button variant="default" onClick={() => setStep(0)} disabled={busy}>
                  Back
                </Button>
                <Button type="submit" loading={busy}>
                  Check and save
                </Button>
              </Group>
            </Stack>
          </form>
        </Stepper.Step>

        <Stepper.Step label="Choose" description="What the AI sees">
          {connectionId && (
            <Stack mt="md">
              <Alert color="green">The connection was checked and saved.</Alert>
              <AllowlistSection
                connectionId={connectionId}
                initialSummary={summary}
                initialReadError={readError}
                onSaved={() => navigate(`/connections/${connectionId}`)}
              />
              <Group justify="flex-end">
                <Button
                  variant="subtle"
                  onClick={() => navigate(`/connections/${connectionId}`)}
                >
                  Skip for now
                </Button>
              </Group>
            </Stack>
          )}
        </Stepper.Step>
      </Stepper>
    </Stack>
  );
}
