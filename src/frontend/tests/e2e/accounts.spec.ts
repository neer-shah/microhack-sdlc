import { expect, test, type Page } from '@playwright/test';
import { fillDelivery, loginCustomer, registerCustomer } from './accountHelpers';

async function addItem(page: Page) {
  await page.goto('/products');
  await page.locator('#increase-qty-1').click();
  await page.locator('#add-to-cart-1').click();
  await expect(page.getByRole('status')).toContainText('Added 1 item to your cart.');
}

test('guest delivery draft survives refresh and registration; signed-in orders appear in history', async ({ page }) => {
  await addItem(page);
  await page.goto('/checkout');
  await fillDelivery(page);
  await page.reload();
  await expect(page.getByLabel('Street address')).toHaveValue('1 Cat Lane');
  await expect(page.getByLabel('Ordering branch')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Sign in to continue', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByRole('link', { name: 'Create an account', exact: true }).click();
  const email = `guest-${crypto.randomUUID()}@example.com`;
  await page.getByLabel('Name', { exact: true }).fill('Guest Keeper');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('a-valid-test-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByLabel('Street address')).toHaveValue('1 Cat Lane');
  await expect(page.getByRole('region', { name: 'Account contact' })).toContainText('Guest Keeper');
  await expect(page.getByRole('region', { name: 'Account contact' })).toContainText(email);
  await expect(page.getByLabel('Full name')).toHaveCount(0);
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Review your order', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Delivery review' })).toContainText('1 Cat Lane');
  await expect(page.getByRole('region', { name: 'Delivery review' })).toContainText('Guest Keeper');
  await expect(page.getByRole('region', { name: 'Delivery review' })).toContainText(email);
  const placed = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/checkout'));
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  expect((await placed).postDataJSON().delivery).toMatchObject({ name: 'Guest Keeper', email });
  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
  const confirmation = page.url();
  await page.getByRole('link', { name: 'My orders', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'My orders', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View order', exact: true }).click();
  await expect(page).toHaveURL(confirmation);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Order confirmed', exact: true })).toBeVisible();
});

test('checkout uses login contact details instead of saved draft contact details', async ({ page }) => {
  await addItem(page);
  const credentials = await registerCustomer(page);
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await loginCustomer(page, credentials);
  await page.goto('/checkout');
  await expect(page.getByRole('region', { name: 'Account contact' })).toContainText(credentials.name);
  await expect(page.getByRole('region', { name: 'Account contact' })).toContainText(credentials.email);
  await fillDelivery(page);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((key) => key.startsWith('octocat-checkout-draft:'));
    if (!key) { throw new Error('Checkout draft was not saved'); }
    const draft = JSON.parse(sessionStorage.getItem(key) ?? '');
    draft.delivery.name = draft.review.request.delivery.name = 'Old draft name';
    draft.delivery.email = draft.review.request.delivery.email = 'old-draft@example.com';
    sessionStorage.setItem(key, JSON.stringify(draft));
  });
  await page.reload();
  const review = page.getByRole('region', { name: 'Delivery review' });
  await expect(review).toContainText(credentials.name);
  await expect(review).toContainText(credentials.email);
  await expect(review).not.toContainText('old-draft@example.com');
  const placed = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/checkout'));
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  expect((await placed).postDataJSON().delivery).toMatchObject({ name: credentials.name, email: credentials.email });
  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
});

test('lost checkout response is recovered after reload without another order', async ({ page }) => {
  await addItem(page);
  await registerCustomer(page);
  await page.goto('/checkout');
  await fillDelivery(page);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  let orderId: number | undefined;
  await page.route('**/api/carts/*/checkout', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    orderId = (await response.json()).orderId;
    await route.abort('failed');
  }, { times: 1 });
  // Hold receipt lookups until the refresh to prove persistent recovery.
  await page.route('**/api/carts/*/checkouts/*', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry / check order', exact: true })).toBeVisible();
  await page.unroute('**/api/carts/*/checkouts/*');
  await page.reload();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
  await expect(page.getByText(`Order #${orderId} / Pending`, { exact: true })).toBeVisible();
  await page.goto('/orders');
  await expect(page.getByRole('link', { name: 'View order', exact: true })).toHaveCount(1);
});

test('account cart survives sign-out, merges new guest items and restores on another device', async ({ page, browser }) => {
  await addItem(page);
  const credentials = await registerCustomer(page);
  await expect(page.getByLabel('Quantity: 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByText('Your cart is empty.', { exact: false })).toBeVisible();
  await addItem(page);
  await loginCustomer(page, credentials);
  await expect(page.getByLabel('Quantity: 2', { exact: true })).toBeVisible();
  const device = await browser.newContext();
  try {
    const second = await device.newPage();
    await second.goto(new URL('/login', page.url()).toString());
    await second.getByLabel('Email address').fill(credentials.email);
    await second.getByLabel('Password').fill(credentials.password);
    await second.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(second.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
    await second.goto(new URL('/cart', page.url()).toString());
    await expect(second.getByLabel('Quantity: 2', { exact: true })).toBeVisible();
  } finally { await device.close(); }
});

test('an order that never reached the API can be retried after refresh using the same checkout ID', async ({ page }) => {
  await addItem(page);
  await registerCustomer(page);
  await page.goto('/checkout');
  await fillDelivery(page);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  let firstId = '';
  await page.route('**/api/carts/*/checkout', async (route) => {
    firstId = route.request().postDataJSON().checkoutId;
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry / check order', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry / check order', exact: true })).toBeEnabled();
  const retried = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/checkout'));
  await page.getByRole('button', { name: 'Retry / check order', exact: true }).click();
  expect((await retried).postDataJSON().checkoutId).toBe(firstId);
  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
  await page.goto('/orders');
  await expect(page.getByRole('link', { name: 'View order', exact: true })).toHaveCount(1);
});

test('logout removes private history and drafts across tabs, and a second account sees no previous orders', async ({ page, context }) => {
  await addItem(page);
  await registerCustomer(page);
  await page.goto('/checkout');
  await fillDelivery(page);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
  const privateUrl = page.url();
  const second = await context.newPage();
  await second.goto('/orders');
  await expect(second.getByRole('link', { name: 'View order', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Sign in to view your orders', exact: true })).toBeVisible();
  await registerCustomer(page);
  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: 'No orders yet', exact: true })).toBeVisible();
  await page.goto(privateUrl);
  await expect(page.getByRole('alert')).toContainText('not found');
});

test('signed-in account navigation and checkout fit a 320px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await addItem(page);
  await registerCustomer(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/checkout');
  await fillDelivery(page);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Place order', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('an expired session requires login and restores the account checkout review', async ({ page, context }) => {
  await addItem(page);
  const credentials = await registerCustomer(page);
  await page.goto('/checkout');
  await fillDelivery(page);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your order', exact: true })).toBeVisible();
  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Place order', exact: true })).toHaveCount(0);
  await loginCustomer(page, credentials, '/checkout');
  await expect(page.getByRole('heading', { name: 'Review your order', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Delivery review' })).toContainText('1 Cat Lane');
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
  await context.clearCookies();
  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: 'Sign in to view your orders', exact: true })).toBeVisible();
  await loginCustomer(page, credentials, '/orders');
  await expect(page.getByRole('link', { name: 'View order', exact: true })).toHaveCount(1);
});
