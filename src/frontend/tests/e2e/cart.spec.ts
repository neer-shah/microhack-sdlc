import { expect, test, type Page } from '@playwright/test';
import { fillDelivery, registerCustomer } from './accountHelpers';

async function addFeeder(page: Page) {
  await page.goto('/products');
  await page.locator('#increase-qty-1').click();
  await page.locator('#add-to-cart-1').click();
  await expect(page.getByRole('status')).toContainText('Added 1 item to your cart.');
}

async function reviewOrder(page: Page) {
  await registerCustomer(page);
  await page.goto('/cart');
  await page.getByRole('link', { name: 'Continue to checkout', exact: true }).click();
  await fillDelivery(page);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your order', exact: true })).toBeVisible();
}

test('cart persists across pages, reloads and browser tabs; quantities and deletion synchronize', async ({ page, context }) => {
  await addFeeder(page);
  await page.getByRole('link', { name: 'About us', exact: true }).click();
  await page.getByRole('link', { name: 'Cart, 1 items', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SmartFeeder One', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Quantity: 1', { exact: true })).toBeVisible();
  const second = await context.newPage();
  await second.goto('/cart');
  await expect(second.getByLabel('Quantity: 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Increase quantity of SmartFeeder One', exact: true }).click();
  await expect(page.getByLabel('Quantity: 2', { exact: true })).toBeVisible();
  await expect(second.getByLabel('Quantity: 2', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Delete SmartFeeder One', exact: true }).click();
  await expect(page.getByText('Your cart is empty.', { exact: false })).toBeVisible();
  await expect(second.getByText('Your cart is empty.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue to checkout', exact: true })).toHaveCount(0);
});

test('delivery, review and confirmation create an order and empty the saved cart', async ({ page }) => {
  await addFeeder(page);
  await reviewOrder(page);
  await expect(page.getByRole('region', { name: 'Delivery review' })).toContainText('1 Cat Lane');
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
  await expect(page.getByRole('heading', { name: 'Order confirmed', exact: true })).toBeVisible();
  await expect(page.getByText(/Order #\d+ \/ Pending/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Order #\d+ \/ Pending/)).toBeVisible();
  await page.goto('/cart');
  await expect(page.getByText('Your cart is empty.', { exact: false })).toBeVisible();
});

test('checkout detects a cart changed in another tab and requires another review', async ({ page, context }) => {
  await addFeeder(page);
  await reviewOrder(page);
  const second = await context.newPage();
  await second.goto('/cart');
  await second.getByRole('button', { name: 'Increase quantity of SmartFeeder One', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your cart or its prices changed');
  await expect(page.getByRole('button', { name: 'Place order', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit delivery / review latest cart', exact: true }).click();
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Place order', exact: true })).toBeEnabled();
});

test('a failed add keeps the selected quantity and shows an actionable error', async ({ page }) => {
  await page.goto('/products');
  await page.route('**/api/carts/*/items', (route) => route.abort('failed'));
  await page.locator('#increase-qty-1').click();
  await page.locator('#add-to-cart-1').click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach the cart service');
  await expect(page.locator('#qty-1')).toHaveText('1');
  await expect(page.getByRole('link', { name: 'Cart, 0 items', exact: true })).toBeVisible();
});

test('a lost checkout response automatically recovers the original order confirmation', async ({ page }) => {
  await addFeeder(page);
  await reviewOrder(page);
  let originalOrderId: number | undefined;
  await page.route('**/api/carts/*/checkout', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    originalOrderId = (await response.json()).orderId;
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
  await expect(page.getByText(`Order #${originalOrderId} / Pending`, { exact: true })).toBeVisible();
});

test('cart and checkout remain usable at 320px and support dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await addFeeder(page);
  await page.getByRole('link', { name: 'Cart, 1 items', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle dark/light mode' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('button', { name: 'Delete SmartFeeder One' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue to checkout', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Continue to checkout', exact: true }).click();
  await expect(page.getByLabel('Street address')).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
