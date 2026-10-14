import { expect, type Page } from '@playwright/test';

/** The sample database (infra/sample-db), seen from this machine. */
export const SAMPLE = {
  host: '127.0.0.1',
  port: 5433,
  databaseName: 'sample',
  username: 'sample_ro',
  password: 'sample_ro_password',
};

/** A new user for each test, removed at the end. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@localhost`;
}

/** Signs in through the page's dev login form, as a person would. */
export async function signInWithForm(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Dev sign-in' }).click();
  await expect(page).toHaveURL(/\/ask/);
}

/**
 * Signs in with a request instead of the form, for tests about other pages. The refresh
 * cookie lands in the browser context, so the page is signed in when it loads.
 */
export async function signInByApi(page: Page, email: string): Promise<string> {
  const response = await page.request.post('/v1/auth/dev/login', {
    data: { email, name: 'Browser test' },
  });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { accessToken: string }).accessToken;
}

async function finish(page: Page, token: string, job: { id: string }) {
  for (let i = 0; i < 150; i += 1) {
    const view = await (
      await page.request.get(`/v1/jobs/${job.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    if (['succeeded', 'failed', 'cancelled'].includes(view.state)) {
      return view;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`Job ${job.id} did not finish`);
}

/** Connects the sample database and reads its schema, without the wizard. */
export async function connectByApi(page: Page, token: string): Promise<string> {
  const headers = { Authorization: `Bearer ${token}` };
  const created = await finish(
    page,
    token,
    await (
      await page.request.post('/v1/connections', {
        headers,
        data: {
          label: 'Sample shop',
          sslMode: 'require',
          sendSampleRowsToLlm: false,
          ...SAMPLE,
        },
      })
    ).json(),
  );
  expect(created.state).toBe('succeeded');
  const id = created.result.id as string;
  const read = await finish(
    page,
    token,
    await (
      await page.request.post(`/v1/connections/${id}/schema/refresh`, { headers })
    ).json(),
  );
  expect(read.state).toBe('succeeded');
  return id;
}

/** Removes the test user and everything it made. Does nothing if it is already gone. */
export async function deleteTestAccount(page: Page): Promise<void> {
  const refreshed = await page.request.post('/v1/auth/refresh');
  if (!refreshed.ok()) {
    return;
  }
  const { accessToken } = (await refreshed.json()) as { accessToken: string };
  await page.request.delete('/v1/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/** Opens a page from the menu, through the drawer on a phone. */
export async function openFromMenu(page: Page, name: string): Promise<void> {
  const burger = page.getByRole('button', { name: 'Toggle menu' });
  if (await burger.isVisible()) {
    await burger.click();
  }
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name })
    .click();
}
