import {
  Accordion,
  Badge,
  Button,
  Checkbox,
  Group,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import type { AllowlistInput, AllowlistView } from '../api/types';
import { useAuth } from '../auth/auth-context';
import { ErrorAlert } from './ErrorAlert';

const DESCRIPTION_MAX = 500;

interface ColumnChoice {
  allowed: boolean;
  description: string;
}

interface TableChoice {
  allowed: boolean;
  description: string;
  columns: Record<string, ColumnChoice>;
}

type Choices = Record<string, TableChoice>;

function keyOf(table: { schema: string; name: string }): string {
  return `${table.schema}.${table.name}`;
}

function initialChoices(view: AllowlistView): Choices {
  const choices: Choices = {};
  for (const table of view.tables) {
    const columns: Record<string, ColumnChoice> = {};
    for (const column of table.columns) {
      columns[column.name] = {
        allowed: column.allowed,
        description: column.description ?? '',
      };
    }
    choices[keyOf(table)] = {
      allowed: table.allowed,
      description: table.description ?? '',
      columns,
    };
  }
  return choices;
}

/** The PUT body: only what is allowed. Exported for tests. */
export function toAllowlistInput(view: AllowlistView, choices: Choices): AllowlistInput {
  return {
    version: view.version,
    tables: view.tables
      .filter((table) => choices[keyOf(table)].allowed)
      .map((table) => {
        const choice = choices[keyOf(table)];
        return {
          schema: table.schema,
          name: table.name,
          description: choice.description.trim() || null,
          columns: table.columns
            .filter((column) => choice.columns[column.name].allowed)
            .map((column) => ({
              name: column.name,
              description: choice.columns[column.name].description.trim() || null,
            })),
        };
      }),
  };
}

/**
 * Chooses which tables and columns the AI may see (blueprint 8.2 step 7). The model is shown
 * only these, and the SQL guard refuses anything else. Columns that look sensitive (emails,
 * phone numbers, tokens) start hidden. Descriptions are optional hints for the model.
 * Remount with key={view.version} after a reload, so the choices start from the new view.
 */
export function AllowlistEditor({
  connectionId,
  view,
  onSaved,
  onReload,
}: {
  connectionId: string;
  view: AllowlistView;
  onSaved: () => void;
  onReload: () => void;
}) {
  const { api } = useAuth();
  const [choices, setChoices] = useState(() => initialChoices(view));
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const visible = useMemo(
    () =>
      view.tables.filter((table) =>
        keyOf(table).toLowerCase().includes(filter.trim().toLowerCase()),
      ),
    [view.tables, filter],
  );

  // An allowed table with no allowed column would show the model a table it cannot query.
  const empty = view.tables.filter((table) => {
    const choice = choices[keyOf(table)];
    return choice.allowed && !Object.values(choice.columns).some((c) => c.allowed);
  });
  const allowedCount = view.tables.filter((t) => choices[keyOf(t)].allowed).length;

  function setTable(key: string, change: Partial<TableChoice>) {
    setChoices((current) => ({ ...current, [key]: { ...current[key], ...change } }));
  }

  function setColumn(key: string, column: string, change: Partial<ColumnChoice>) {
    setChoices((current) => ({
      ...current,
      [key]: {
        ...current[key],
        columns: {
          ...current[key].columns,
          [column]: { ...current[key].columns[column], ...change },
        },
      },
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.put(
        `/v1/connections/${connectionId}/allowlist`,
        toAllowlistInput(view, choices),
      );
      onSaved();
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  }

  const schemaChanged = error instanceof ApiError && error.code === 'SCHEMA_CHANGED';

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        The AI sees only the tables and columns ticked here, and queries using anything
        else are refused. Columns marked sensitive start hidden. {allowedCount} of{' '}
        {view.tables.length} tables allowed.
      </Text>
      {view.tables.length > 8 && (
        <TextInput
          label="Find a table"
          placeholder="schema.table"
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
        />
      )}
      {view.tables.length === 0 && (
        <Text c="dimmed">This login cannot see any tables. Check its grants.</Text>
      )}
      <Accordion multiple variant="separated">
        {visible.map((table) => {
          const key = keyOf(table);
          const choice = choices[key];
          const columnsOn = Object.values(choice.columns).filter((c) => c.allowed).length;
          return (
            <Accordion.Item key={key} value={key}>
              <Group wrap="nowrap" pl="md" gap="xs">
                <Checkbox
                  aria-label={`Allow table ${key}`}
                  checked={choice.allowed}
                  onChange={(event) =>
                    setTable(key, { allowed: event.currentTarget.checked })
                  }
                />
                <Accordion.Control>
                  <Group gap="xs" wrap="nowrap">
                    <Text fw={500} truncate>
                      {key}
                    </Text>
                    {table.kind !== 'table' && (
                      <Badge size="xs" variant="outline">
                        {table.kind.replace('_', ' ')}
                      </Badge>
                    )}
                    <Text size="xs" c="dimmed">
                      {columnsOn}/{table.columns.length} columns
                    </Text>
                  </Group>
                </Accordion.Control>
              </Group>
              <Accordion.Panel>
                <Stack gap="xs">
                  <TextInput
                    size="xs"
                    label="What this table holds (optional)"
                    maxLength={DESCRIPTION_MAX}
                    value={choice.description}
                    onChange={(event) =>
                      setTable(key, { description: event.currentTarget.value })
                    }
                  />
                  {table.columns.map((column) => {
                    const columnChoice = choice.columns[column.name];
                    return (
                      <Group key={column.name} gap="xs" wrap="nowrap" align="flex-start">
                        <Checkbox
                          mt={6}
                          aria-label={`Allow column ${key}.${column.name}`}
                          checked={columnChoice.allowed}
                          disabled={!choice.allowed}
                          onChange={(event) =>
                            setColumn(key, column.name, {
                              allowed: event.currentTarget.checked,
                            })
                          }
                        />
                        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                          <Group gap="xs">
                            <Text size="sm">{column.name}</Text>
                            <Text size="xs" c="dimmed">
                              {column.type}
                            </Text>
                            {column.sensitive && (
                              <Badge size="xs" color="orange" variant="light">
                                sensitive
                              </Badge>
                            )}
                          </Group>
                          {columnChoice.allowed && choice.allowed && (
                            <TextInput
                              size="xs"
                              aria-label={`Description for ${key}.${column.name}`}
                              placeholder="Description (optional)"
                              maxLength={DESCRIPTION_MAX}
                              value={columnChoice.description}
                              onChange={(event) =>
                                setColumn(key, column.name, {
                                  description: event.currentTarget.value,
                                })
                              }
                            />
                          )}
                        </Stack>
                      </Group>
                    );
                  })}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
      {empty.length > 0 && (
        <Text size="sm" c="red" role="alert">
          Choose at least one column, or untick the table: {empty.map(keyOf).join(', ')}.
        </Text>
      )}
      {error !== null && (
        <ErrorAlert error={error} title="The allowlist was not saved">
          {schemaChanged && (
            <Button size="xs" mt="sm" variant="white" onClick={onReload}>
              Reload the allowlist
            </Button>
          )}
        </ErrorAlert>
      )}
      <Group justify="flex-end">
        <Button onClick={() => void save()} loading={saving} disabled={empty.length > 0}>
          Save allowlist
        </Button>
      </Group>
    </Stack>
  );
}
