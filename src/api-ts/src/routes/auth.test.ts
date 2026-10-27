import { randomUUID, scryptSync } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import auth from './auth';
import carts from './cart';
import customer from './customer';
import orders from './order';
import details from './orderDetail';
import { closeDatabase, getDatabase } from '../db/sqlite';
import { runMigrations } from '../db/migrate';
import { errorHandler } from '../utils/errors';

let app: express.Express;
const credentials = { name: 'Cat Keeper', email: 'keeper@example.com', password: 'a-valid-test-password' };
const cookie = (response: request.Response): string => response.headers['set-cookie'][0].split(';')[0];
beforeEach(async () => {
  await closeDatabase();
  const connection = await getDatabase(true);
  await runMigrations(true);
  connection.db.exec(`
    INSERT INTO headquarters (headquarters_id, name) VALUES (1, 'HQ');
    INSERT INTO branches (branch_id, headquarters_id, name) VALUES (1, 1, 'Branch');
    INSERT INTO suppliers (supplier_id, name) VALUES (1, 'Supplier');
    INSERT INTO products (product_id, supplier_id, name, price, sku, unit) VALUES (1, 1, 'Feeder', 10, 'F1', 'each');
  `);
  app = express(); app.use(express.json());
  app.use('/api/auth', auth); app.use('/api/carts', carts); app.use('/api/me', customer);
  app.use('/api/orders', orders); app.use('/api/order-details', details);
  app.use(errorHandler);
});
afterEach(() => closeDatabase());
const register = (email = credentials.email, guestCartId?: string) =>
  request(app).post('/api/auth/register').send({ ...credentials, email, ...(guestCartId ? { guestCartId } : {}) });

describe('Customer accounts', () => {
  it('stores salted scrypt passwords, restores cookie sessions, normalizes email, and revokes logout', async () => {
    const response = await register('  KEEPER@example.com ');
    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ email: credentials.email, role: 'customer' });
    expect(response.body.user.password).toBeUndefined();
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(response.headers['set-cookie'][0]).toContain('Path=/api');
    const db = (await getDatabase()).db;
    const row = db.prepare('SELECT password_hash FROM users').get() as { password_hash: string };
    const [algorithm, salt, hashed] = row.password_hash.split('$');
    expect(algorithm).toBe('scrypt');
    expect(hashed).toBe(scryptSync(credentials.password, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 }).toString('hex'));
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie(response))).body).toEqual(response.body);
    expect((await register()).status).toBe(409);
    expect((await request(app).post('/api/auth/login').send({ email: credentials.email, password: 'a-wrong-password' })).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password });
    expect(login.status).toBe(200);
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie(login))).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie(login))).status).toBe(401);
    db.prepare('UPDATE auth_sessions SET expires_at = 0').run();
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie(response))).status).toBe(401);
  });

  it('rejects spoofed roles, short passwords, bad origins and throttles invalid logins', async () => {
    expect((await request(app).post('/api/auth/register').send({ ...credentials, role: 'admin' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ ...credentials, password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').set('Origin', 'https://untrusted.example').send(credentials)).status).toBe(403);
    for (let index = 0; index < 10; index++) {
      expect((await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password })).status).toBe(401);
    }
    expect((await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password })).status).toBe(429);
  });

  it('merges guest carts once, retains account cart on another login, and isolates it from guests and other accounts', async () => {
    const guest = randomUUID();
    await request(app).post(`/api/carts/${guest}/items`).send({ productId: 1, quantity: 2 });
    const first = await register(credentials.email, guest);
    const id = first.body.cartId;
    expect((await request(app).get(`/api/carts/${id}`).set('Cookie', cookie(first))).body.itemCount).toBe(2);
    expect((await request(app).get(`/api/carts/${id}`)).status).toBe(401);
    expect((await request(app).get(`/api/carts/${guest}`)).status).toBe(404);
    const login = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password, guestCartId: guest });
    expect(login.status).toBe(200);
    expect(login.body.cartId).toBe(id);
    expect((await request(app).get(`/api/carts/${id}`).set('Cookie', cookie(login))).body.itemCount).toBe(2);
    const second = await register('another@example.com');
    expect((await request(app).get(`/api/carts/${id}`).set('Cookie', cookie(second))).status).toBe(404);
    expect((await request(app).post(`/api/carts/${id}/items`).set('Cookie', cookie(second)).send({ productId: 1, quantity: 1 })).status).toBe(404);
    expect((await request(app).post('/api/auth/login').send({
      email: 'another@example.com', password: credentials.password, guestCartId: guest,
    })).status).toBe(404);
  });

  it('rolls back a merge exceeding the quantity limit', async () => {
    const first = await register();
    const guest = randomUUID();
    await request(app).post(`/api/carts/${first.body.cartId}/items`).set('Cookie', cookie(first)).send({ productId: 1, quantity: 999 });
    await request(app).post(`/api/carts/${guest}/items`).send({ productId: 1, quantity: 1 });
    expect((await request(app).post('/api/auth/login').send({
      email: credentials.email, password: credentials.password, guestCartId: guest,
    })).status).toBe(409);
    expect((await request(app).get(`/api/carts/${guest}`)).body.itemCount).toBe(1);
    expect((await request(app).get(`/api/carts/${first.body.cartId}`).set('Cookie', cookie(first))).body.itemCount).toBe(999);
  });

  it('requires sign-in to checkout and protects order history, receipts and legacy order APIs', async () => {
    expect((await request(app).post(`/api/carts/${randomUUID()}/checkout`).send({})).status).toBe(401);
    expect((await request(app).get('/api/me/orders')).status).toBe(401);
    const first = await register();
    const second = await register('second@example.com');
    const id = first.body.cartId;
    const cart = (await request(app).post(`/api/carts/${id}/items`).set('Cookie', cookie(first)).send({ productId: 1, quantity: 2 })).body;
    const checkoutId = randomUUID();
    const receipt = await request(app).post(`/api/carts/${id}/checkout`).set('Cookie', cookie(first)).send({
      checkoutId, branchId: 1, expectedVersion: cart.version, expectedTotalCents: cart.totalCents,
      delivery: { name: 'Keeper', email: credentials.email, address: '1 Cat Lane', city: 'London', postalCode: 'N1', country: 'UK' },
    });
    expect(receipt.status).toBe(201);
    expect((await request(app).get('/api/me/orders').set('Cookie', cookie(first))).body).toEqual([receipt.body]);
    expect((await request(app).get('/api/me/orders').set('Cookie', cookie(second))).body).toEqual([]);
    expect((await request(app).get(`/api/me/orders/${receipt.body.orderId}`).set('Cookie', cookie(second))).status).toBe(404);
    expect((await request(app).get(`/api/carts/${id}/checkouts/${checkoutId}`)).status).toBe(401);
    expect((await request(app).get(`/api/carts/${id}/checkouts/${checkoutId}`).set('Cookie', cookie(second))).status).toBe(404);
    expect((await request(app).get('/api/orders')).status).toBe(401);
    expect((await request(app).get('/api/orders').set('Cookie', cookie(first))).body).toHaveLength(1);
    expect((await request(app).get('/api/orders').set('Cookie', cookie(second))).body).toEqual([]);
    expect((await request(app).get(`/api/orders/${receipt.body.orderId}`).set('Cookie', cookie(second))).status).toBe(404);
    expect((await request(app).post('/api/orders').set('Cookie', cookie(first)).send({})).status).toBe(403);
    expect((await request(app).get('/api/order-details').set('Cookie', cookie(second))).body).toEqual([]);
    const detail = (await request(app).get('/api/order-details').set('Cookie', cookie(first))).body[0];
    expect((await request(app).get(`/api/order-details/${detail.orderDetailId}`).set('Cookie', cookie(second))).status).toBe(404);
    expect((await request(app).delete(`/api/order-details/${detail.orderDetailId}`).set('Cookie', cookie(first))).status).toBe(403);
  });
});
