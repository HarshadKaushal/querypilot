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
import { useForm } from '@mantine/form';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ErrorAlert } from '../../components/ErrorAlert';
import { JobProgress } from '../../components/JobProgress';
import type { ConnectionInput, RefreshSummary } from '../../lib/api-types';
import { queryKeys } from '../../lib/query-keys';
import { useJobRunner } from '../../lib/use-job-runner';
import { useAuth } from '../auth';
import { createConnection, refreshSchema, useEgress } from './api';
import { AllowlistSection } from './components/AllowlistSection';

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
  const [step, setStep] = useState(0);
  // The form's values and per-field errors. validateConnection runs on submit, and a
  // field's error clears as soon as it is edited.
  const form = useForm<ConnectionForm>({
    mode: 'controlled',
    initialValues: EMPTY_FORM,
    validate: validateConnection,
  });
  const job = useJobRunner();
  // Which of the two jobs is running, for the progress label.
  const [stage, setStage] = useState('');
  const [failure, setFailure] = useState<unknown>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<RefreshSummary | null>(null);
  const [readError, setReadError] = useState<unknown>(null);

  const egress = useEgress();

  /** Runs only when every field passed validateConnection. */
  async function save(values: ConnectionForm) {
    setFailure(null);
    setStage('Saving the connection');
    const created = await job.run((options) =>
      createConnection(
        api,
        {
          ...values,
          port: Number(values.port),
          label: values.label.trim(),
          host: values.host.trim(),
        },
        options,
      ),
    );
    if (!created) {
      return;
    }
    if (!created.ok) {
      setFailure(created.error);
      return;
    }
    // Saved: the password is not kept in the page any longer than needed.
    const id = created.result.id;
    form.setFieldValue('password', '');
    setConnectionId(id);
    void queryClient.invalidateQueries({ queryKey: queryKeys.connections });

    setStage('Reading the schema');
    const read = await job.run((options) => refreshSchema(api, id, options));
    if (!read) {
      return;
    }
    if (read.ok) {
      setSummary(read.result);
    } else {
      // The connection is saved; the next step offers to read the schema again.
      setReadError(read.error);
    }
    setStep(2);
  }

  const busy = job.busy;

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
                <Code block tabIndex={0} aria-label="Setup SQL">
                  {egress.data.setupSql}
                </Code>
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
          <form onSubmit={form.onSubmit(save)} noValidate>
            <Stack mt="md">
              {/* getInputProps wires value, onChange, and error to the form's field. */}
              <TextInput
                label="Name"
                description="Only for you, for example Sales database"
                {...form.getInputProps('label')}
                disabled={busy}
              />
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <TextInput
                  label="Host"
                  placeholder="db.example.com"
                  {...form.getInputProps('host')}
                  disabled={busy}
                  style={{ gridColumn: 'span 2' }}
                />
                <NumberInput
                  label="Port"
                  {...form.getInputProps('port')}
                  disabled={busy}
                  hideControls
                />
              </SimpleGrid>
              <TextInput
                label="Database"
                {...form.getInputProps('databaseName')}
                disabled={busy}
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label="Username"
                  autoComplete="off"
                  {...form.getInputProps('username')}
                  disabled={busy}
                />
                <PasswordInput
                  label="Password"
                  autoComplete="new-password"
                  {...form.getInputProps('password')}
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
                // Not getInputProps: Select hands onChange a string | null, and the form
                // field only accepts the two allowed modes.
                value={form.values.sslMode}
                onChange={(value) =>
                  form.setFieldValue(
                    'sslMode',
                    (value ?? 'require') as ConnectionForm['sslMode'],
                  )
                }
                allowDeselect={false}
                disabled={busy}
              />
              <Checkbox
                label="Let the AI see up to 20 result rows when it writes the summary"
                description="Off: it sees only column names, the row count, and numeric totals."
                {...form.getInputProps('sendSampleRowsToLlm', { type: 'checkbox' })}
                disabled={busy}
              />
              {failure !== null && (
                <ErrorAlert error={failure} title="The connection was not saved" />
              )}
              {busy && <JobProgress view={job.progress} label={stage} />}
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
