import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ApiError } from '../../lib/api-client';
import type { PublicConnection } from '../../lib/api-types';
import { queryKeys } from '../../lib/query-keys';
import { useAuth } from '../auth';
import { deleteConnection, useConnections } from './api';

/** The user's saved databases. Never shows usernames or passwords. */
export function ConnectionsPage() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<PublicConnection | null>(null);

  const connections = useConnections();

  const remove = useMutation({
    mutationFn: (id: string) => deleteConnection(api, id),
    onSuccess: () => {
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
    },
    onError: (error) => {
      setDeleting(null);
      notifications.show({
        color: 'red',
        title: 'The connection was not deleted',
        message: error instanceof ApiError ? error.message : 'Try again.',
      });
    },
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Connections</Title>
        <Button component={Link} to="/connections/new">
          Connect a database
        </Button>
      </Group>
      {connections.isPending && <Loader aria-label="Loading connections" />}
      {connections.isError && (
        <ErrorAlert error={connections.error} title="Could not load connections" />
      )}
      {connections.data?.length === 0 && (
        <Text c="dimmed">
          No databases connected yet. Connect one to start asking questions.
        </Text>
      )}
      {connections.data && connections.data.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {connections.data.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              onDelete={() => setDeleting(connection)}
            />
          ))}
        </SimpleGrid>
      )}
      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete connection?"
      >
        <Stack>
          <Text size="sm">
            Delete <b>{deleting?.label}</b>? Its schema, allowlist, saved answers, and
            history are deleted too. Your database itself is not touched.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function ConnectionCard({
  connection,
  onDelete,
}: {
  connection: PublicConnection;
  onDelete: () => void;
}) {
  const failing = connection.status === 'failing';
  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600} truncate>
            {connection.label}
          </Text>
          <Badge color={failing ? 'red' : 'green'} variant="light">
            {failing ? 'Failing' : 'Active'}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed" truncate>
          {connection.host}:{connection.port}/{connection.databaseName}
        </Text>
        <Text size="xs" c="dimmed">
          {connection.lastTestedAt
            ? `Last checked ${new Date(connection.lastTestedAt).toLocaleString()}`
            : 'Not checked yet'}
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button
            component={Link}
            to={`/connections/${connection.id}`}
            variant="light"
            size="xs"
          >
            Open
          </Button>
          <Button variant="subtle" color="red" size="xs" onClick={onDelete}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
