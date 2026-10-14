import {
  Avatar,
  Button,
  Card,
  Group,
  List,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { ErrorAlert } from '../components/ErrorAlert';

/** The signed-in account: who you are, sign out, and delete the account. */
export function SettingsPage() {
  const { state, api, signOut } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const user = state.status === 'signedIn' ? state.user : null;
  if (!user) {
    return null;
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await api.delete('/v1/users/me');
      // The server removed the session too; this clears the page's copy of it.
      await signOut();
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }

  return (
    <Stack maw={700}>
      <Title order={2}>Settings</Title>
      <Card withBorder padding="lg" radius="md">
        <Group>
          <Avatar src={user.avatarUrl} alt="" radius="xl" size="lg">
            {user.name.slice(0, 1).toUpperCase()}
          </Avatar>
          <div>
            <Text fw={600}>{user.name}</Text>
            <Text size="sm" c="dimmed">
              {user.email}
            </Text>
            <Text size="xs" c="dimmed">
              Plan: {user.planTier}
            </Text>
          </div>
        </Group>
        <Group mt="md">
          <Button variant="default" onClick={() => void signOut()}>
            Sign out
          </Button>
        </Group>
      </Card>
      <Card withBorder padding="lg" radius="md">
        <Stack gap="xs">
          <Text fw={600} c="red">
            Delete account
          </Text>
          <Text size="sm">
            Removes your account and everything stored for it. Your own databases are not
            touched.
          </Text>
          <Group>
            <Button color="red" variant="light" onClick={() => setDeleting(true)}>
              Delete account
            </Button>
          </Group>
        </Stack>
      </Card>
      <Modal
        opened={deleting}
        onClose={() => {
          setDeleting(false);
          setConfirm('');
        }}
        title="Delete your account?"
      >
        <Stack>
          <Text size="sm">This cannot be undone. It deletes:</Text>
          <List size="sm">
            <List.Item>your saved connections and their encrypted logins</List.Item>
            <List.Item>schemas, allowlists, and saved queries</List.Item>
            <List.Item>your question history and usage counts</List.Item>
          </List>
          <Text size="sm">
            A security log keeps a record that the account was deleted: its id, but not
            your name or email.
          </Text>
          <TextInput
            label='Type "delete" to confirm'
            value={confirm}
            onChange={(event) => setConfirm(event.currentTarget.value)}
          />
          {error !== null && (
            <ErrorAlert error={error} title="The account was not deleted" />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              disabled={confirm.trim().toLowerCase() !== 'delete'}
              loading={busy}
              onClick={() => void deleteAccount()}
            >
              Delete my account
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
