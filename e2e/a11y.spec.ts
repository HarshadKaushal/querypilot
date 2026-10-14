import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { connectByApi, deleteTestAccount, signInByApi, uniqueEmail } from './helpers';

// Automated accessibility checks (WCAG 2.1 A and AA rules in axe) on every page, at desktop
// and phone sizes. Serious and critical problems fail the test.

async function expectNoSeriousProblems(page: Page, where: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    );
  expect(serious, `${where}\n${serious.join('\n')}`).toEqual([]);
}

test.afterEach(async ({ page }) => {
  await deleteTestAccount(page);
});

test('the sign-in page has no serious accessibility problems', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Dev sign-in' })).toBeVisible();
  await expectNoSeriousProblems(page, 'sign-in');
});

test('every signed-in page has no serious accessibility problems', async ({ page }) => {
  const token = await signInByApi(page, uniqueEmail('a11y'));
  const id = await connectByApi(page, token);

  await page.goto('/ask');
  await page.getByLabel('Your question').fill('How many orders does each region have?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(
    page.getByText('Here is what the data shows for your question.'),
  ).toBeVisible();
  await expectNoSeriousProblems(page, 'ask, with an answer');

  for (const [path, ready] of [
    ['/connections', 'Connections'],
    [`/connections/${id}`, 'What the AI can see'],
    ['/connections/new', 'Connect a database'],
    ['/history', 'History'],
    ['/usage', 'Usage'],
    ['/settings', 'Settings'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: ready }).first()).toBeVisible();
    await expectNoSeriousProblems(page, path);
  }
});
