import { expect, test } from '@playwright/test';
import {
  deleteTestAccount,
  openFromMenu,
  SAMPLE,
  signInWithForm,
  uniqueEmail,
} from './helpers';

// The blueprint's demo flow (section 17), on a desktop and a phone screen: sign in, connect,
// ask, see the table and chart, an ambiguous question, and a refused unsafe request. The
// worker uses the scripted model; the guard, executor, chart, and summary are real.

test.afterEach(async ({ page }) => {
  await deleteTestAccount(page);
});

test('sign in, connect the sample database, ask, and see every kind of answer', async ({
  page,
}) => {
  await signInWithForm(page, uniqueEmail('demo'));

  // Connect through the wizard.
  await openFromMenu(page, 'Connections');
  await page.getByRole('link', { name: 'Connect a database' }).first().click();
  await expect(page.getByRole('heading', { name: 'Connect a database' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Sample shop');
  await page.getByLabel('Host', { exact: true }).fill(SAMPLE.host);
  await page.getByLabel('Port', { exact: true }).fill(String(SAMPLE.port));
  await page.getByLabel('Database', { exact: true }).fill(SAMPLE.databaseName);
  await page.getByLabel('Username', { exact: true }).fill(SAMPLE.username);
  await page.getByLabel('Password', { exact: true }).fill(SAMPLE.password);
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByText('The connection was checked and saved.')).toBeVisible();
  // Sensitive columns start hidden; the defaults are saved as they are.
  await page.getByRole('button', { name: 'Save allowlist' }).click();
  await expect(page.getByRole('heading', { name: 'Sample shop' })).toBeVisible();

  // An answered question: summary, chart, and table.
  await openFromMenu(page, 'Ask');
  const question = page.getByLabel('Your question');
  await question.fill('How many orders does each region have?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(
    page.getByText('Here is what the data shows for your question.'),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Chart of orders by region' }),
  ).toBeVisible();
  const table = page.getByRole('table');
  await expect(table.getByRole('cell', { name: 'North', exact: true })).toBeVisible();
  await expect(page.getByText('4 rows in', { exact: false })).toBeVisible();

  // An ambiguous question: a clarifying question, nothing run.
  await question.fill('Which customer is best?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(
    page.getByText('Do you mean the customer with the most orders, or the most spent?'),
  ).toBeVisible();

  // An unsafe request: the model's DELETE is refused by the SQL guard.
  await question.fill('Delete all the orders');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(
    page.getByText('Not run: the query did not pass the safety checks'),
  ).toBeVisible();

  // Unsafe SQL typed by the user is refused the same way.
  await page.getByText('SQL', { exact: true }).click();
  await page.getByLabel(/Your SQL/).fill('DELETE FROM orders');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText(/Safety check: not_select/)).toBeVisible();

  // History and usage record it all; SQL does not use daily questions.
  await openFromMenu(page, 'History');
  await expect(page.getByText('How many orders does each region have?')).toBeVisible();
  await expect(page.getByText('Needed detail')).toBeVisible();
  await openFromMenu(page, 'Usage');
  await expect(page.getByText('3 of 50')).toBeVisible();

  // Delete the account from Settings.
  await openFromMenu(page, 'Settings');
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByLabel('Type "delete" to confirm').fill('delete');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});
