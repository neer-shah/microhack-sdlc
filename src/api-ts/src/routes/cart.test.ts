import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import cartRouter from './cart';
import authRouter from './auth';
import { closeDatabase, getDatabase } from '../db/sqlite';
import { runMigrations } from '../db/migrate';
import { errorHandler } from '../utils/errors';

let app: express.Express;
let cartId: string;
let sessionCookie = '';
const delivery = { name: 'Cat Keeper', email: 'keeper@example.com', address: '1 Cat Lane', city: 'London', postalCode: 'N1 1AA', country: 'UK' };

beforeEach(async () => {
  await closeDatabase();
  const connection = await getDatabase(true);
  await runMigrations(true);
  connection.db.exec(`
    INSERT INTO headquarters (headquarters_id, name) VALUES (1, 'HQ');
    INSERT INTO branches (branch_id, headquarters_id, name) VALUES (1, 1, 'Branch');
    INSERT INTO suppliers (supplier_id, name) VALUES (1, 'Supplier');
    INSERT INTO products (product_id, supplier_id, name, price, discount, sku, unit)
    VALUES (1, 1, 'Feeder', 19.99, 0.1, 'F1', 'each'), (2, 1, 'Camera', 10, 0, 'C1', 'each');
  `);
  app = express();
  sessionCookie = '';
  app.use(express.json());
  app.use((req, _res, next) => { if (sessionCookie) req.headers.cookie = sessionCookie; next(); });
  app.use('/api/auth', authRouter);
  app.use('/api/carts', cartRouter);
  app.use(errorHandler);
  cartId = randomUUID();
});
afterEach(() => closeDatabase());
const url = () => `/api/carts/${cartId}`;
const add = (productId = 1, quantity = 2) => request(app).post(`${url()}/items`).send({ productId, quantity });
const signIn = async () => {
  const response = await request(app).post('/api/auth/register').send({
    name: 'Cat Keeper', email: 'keeper@example.com', password: 'a-valid-test-password', guestCartId: cartId,
  });
  expect(response.status).toBe(201);
  sessionCookie = response.headers['set-cookie'][0].split(';')[0];
  cartId = response.body.cartId;
};

describe('Cart API', () => {
  it('returns an empty cart, persists items, merges quantities, sets and deletes items', async () => {
    expect((await request(app).get(url())).body).toMatchObject({ version: 0, items: [], totalCents: 0 });
    const added = await add();
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ version: 1, totalCents: 3598, itemCount: 2 });
    expect(added.body.items[0]).toMatchObject({ unitPriceCents: 1799, lineTotalCents: 3598 });
    expect((await request(app).get(url())).body).toEqual(added.body);
    expect((await add(1, 1)).body.itemCount).toBe(3);
    expect((await request(app).put(`${url()}/items/1`).send({ quantity: 5 })).body.itemCount).toBe(5);
    expect((await request(app).delete(`${url()}/items/1`)).body.items).toEqual([]);
    expect((await request(app).delete(`${url()}/items/1`)).status).toBe(404);
  });

  it.each([0, -1, 1.5, 1000, '2', null, true])('rejects invalid quantity %s', async (quantity) => {
    expect((await request(app).post(`${url()}/items`).send({ productId: 1, quantity })).status).toBe(400);
    expect((await request(app).get(url())).body.items).toEqual([]);
  });

  it('validates identity, missing products, and quantity overflow without changing the cart', async () => {
    expect((await request(app).get('/api/carts/not-a-uuid')).status).toBe(400);
    expect((await add(999)).status).toBe(404);
    expect((await request(app).put(`${url()}/items/1`).send({ quantity: 1 })).status).toBe(404);
    await add(1, 999);
    expect((await add(1, 1)).status).toBe(400);
    expect((await request(app).get(url())).body.itemCount).toBe(999);
    expect((await request(app).get(`/api/carts/${randomUUID()}`)).body.items).toEqual([]);
  });

  it('creates an atomic order with authoritative discounted prices and an immutable receipt; retries are idempotent', async () => {
    await signIn();
    const cart = (await add()).body;
    const body = { checkoutId: randomUUID(), branchId: 1, delivery, expectedVersion: cart.version, expectedTotalCents: cart.totalCents };
    const placed = await request(app).post(`${url()}/checkout`).send(body);
    expect(placed.status).toBe(201);
    expect(placed.body).toMatchObject({ delivery, totalCents: 3598, itemCount: 2 });
    const db = (await getDatabase()).db;
    expect(db.prepare('SELECT quantity, unit_price FROM order_details').get()).toEqual({ quantity: 2, unit_price: 17.99 });
    expect((await request(app).get(url())).body).toMatchObject({ items: [], version: 2 });
    expect((await request(app).post(`${url()}/checkout`).send(body)).body).toEqual(placed.body);
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 1 });
    expect((await request(app).get(`${url()}/checkouts/${body.checkoutId}`)).body).toEqual(placed.body);
    expect((await request(app).get(`/api/carts/${randomUUID()}/checkouts/${body.checkoutId}`)).status).toBe(404);
    await add(2, 1);
    expect((await request(app).post(`${url()}/checkout`).send(body)).body).toEqual(placed.body);
    expect((await request(app).get(url())).body.itemCount).toBe(1);
  });

  it('rejects stale cart, changed prices, invalid branch and empty checkout', async () => {
    await signIn();
    const cart = (await add()).body;
    const body = { checkoutId: randomUUID(), branchId: 1, delivery, expectedVersion: cart.version, expectedTotalCents: cart.totalCents };
    expect((await request(app).post(`${url()}/checkout`).send({ ...body, expectedVersion: 0 })).status).toBe(409);
    expect((await request(app).post(`${url()}/checkout`).send({ ...body, branchId: 999 })).status).toBe(404);
    (await getDatabase()).db.prepare('UPDATE products SET price = 25 WHERE product_id = 1').run();
    expect((await request(app).post(`${url()}/checkout`).send(body)).status).toBe(409);
    expect((await request(app).post(`/api/carts/${randomUUID()}/checkout`).send(body)).status).toBe(409);
    expect((await getDatabase()).db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 0 });
  });

  it('rolls back the order and retains the cart if a line insert fails', async () => {
    await signIn();
    const cart = (await add()).body;
    const db = (await getDatabase()).db;
    db.exec("CREATE TRIGGER reject_detail BEFORE INSERT ON order_details BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    const response = await request(app).post(`${url()}/checkout`).send({
      checkoutId: randomUUID(), branchId: 1, delivery, expectedVersion: cart.version, expectedTotalCents: cart.totalCents,
    });
    expect(response.status).toBe(500);
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 0 });
    expect((await request(app).get(url())).body).toEqual(cart);
  });

  it('rejects malformed delivery and client-submitted prices', async () => {
    await signIn();
    expect((await request(app).post(`${url()}/items`).send({ productId: 1, quantity: 1, unitPriceCents: 1 })).status).toBe(400);
    const cart = (await add(1, 1)).body;
    expect(cart.totalCents).toBe(1799);
    expect((await request(app).post(`${url()}/checkout`).send({
      checkoutId: randomUUID(), branchId: 1, delivery: { ...delivery, email: 'invalid' },
      expectedVersion: cart.version, expectedTotalCents: cart.totalCents,
    })).status).toBe(400);
  });
});
