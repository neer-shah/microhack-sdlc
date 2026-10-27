import { expect, type Page } from '@playwright/test';

export async function registerCustomer(page: Page) {
  const credentials = { name: 'Cat Keeper', email: `keeper-${crypto.randomUUID()}@example.com`, password: 'a-valid-test-password' };
  await page.goto('/register?returnTo=%2Fcart');
  await page.getByLabel('Name', { exact: true }).fill(credentials.name);
  await page.getByLabel('Email address', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole('link', { name: 'My orders', exact: true })).toBeVisible();
  return credentials;
}

export async function loginCustomer(page: Page, credentials: { email: string; password: string }, returnTo = '/cart') {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel('Email address', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${returnTo}$`));
}

export async function fillDelivery(page: Page) {
  await page.getByLabel('Street address').fill('1 Cat Lane');
  await page.getByLabel('City', { exact: true }).fill('London');
  await page.getByLabel('Postal code').fill('N1 1AA');
  await page.getByLabel('Country', { exact: true }).fill('UK');
  await page.getByLabel('Ordering branch').selectOption({ index: 1 });
}
