import { AppShell, Burger, Button, Group, NavLink, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/auth-context';

// Pages are added here as they are built (Phase 9 steps b to d).
const PAGES = [
  { to: '/ask', label: 'Ask' },
  { to: '/connections', label: 'Connections' },
];

/** The frame around every signed-in page: header, menu (a drawer on phones), content. */
export function AppLayout() {
  const { state, signOut } = useAuth();
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();
  const user = state.status === 'signedIn' ? state.user : null;

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label="Toggle menu"
            />
            <Title order={1} size="h4">
              Ask Your Database
            </Title>
          </Group>
          <Group gap="sm" wrap="nowrap">
            {user && (
              <Text size="sm" visibleFrom="xs" truncate maw={200}>
                {user.name}
              </Text>
            )}
            <Button variant="subtle" size="xs" onClick={() => void signOut()}>
              Sign out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs" aria-label="Main">
        {PAGES.map((page) => (
          <NavLink
            key={page.to}
            component={Link}
            to={page.to}
            label={page.label}
            active={pathname.startsWith(page.to)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
