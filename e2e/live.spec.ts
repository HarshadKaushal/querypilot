import { expect, test } from '@playwright/test';
import { connectByApi, deleteTestAccount, signInByApi, uniqueEmail } from './helpers';

// One question to the real model (npm run test:browser:live), to check the app works with
// Gemini itself. Its wording varies, so only the shape of the answer is checked.

test.afterEach(async ({ page }) => {
  await deleteTestAccount(page);
});

test('answers a real question with the real model', async ({ page }) => {
  const token = await signInByApi(page, uniqueEmail('live'));
  await connectByApi(page, token);
  await page.goto('/ask');
  await page.getByLabel('Your question').fill('How many orders are there?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByText('Summary', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('The SQL that ran')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
