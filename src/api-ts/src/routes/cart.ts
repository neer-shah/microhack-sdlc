/**
 * @swagger
 * tags:
 *   - name: Carts
 *     description: Persistent guest carts and atomic checkout without payment
 * components:
 *   parameters:
 *     CartId:
 *       in: path
 *       name: cartId
 *       required: true
 *       schema: { type: string, format: uuid }
 *     CartProductId:
 *       in: path
 *       name: productId
 *       required: true
 *       schema: { type: integer, minimum: 1 }
 *   responses:
 *     CartResponse:
 *       description: Current cart with server-calculated discounted prices in USD cents
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Cart' }
 *     CartInvalid:
 *       description: Invalid UUID, quantity, delivery details or unknown request field
 *     CartNotFound:
 *       description: Product, branch, cart item or checkout not found
 * /api/carts/{cartId}:
 *   parameters:
 *     - $ref: '#/components/parameters/CartId'
 *   get:
 *     tags: [Carts]
 *     summary: Get a guest cart (an unused UUID returns an empty cart)
 *     responses:
 *       200: { $ref: '#/components/responses/CartResponse' }
 *       400: { $ref: '#/components/responses/CartInvalid' }
 * /api/carts/{cartId}/items:
 *   parameters:
 *     - $ref: '#/components/parameters/CartId'
 *   post:
 *     tags: [Carts]
 *     summary: Add quantity to a product in the cart (maximum 999 per product)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [productId, quantity]
 *             properties:
 *               productId: { type: integer, minimum: 1 }
 *               quantity: { type: integer, minimum: 1, maximum: 999 }
 *     responses:
 *       200: { $ref: '#/components/responses/CartResponse' }
 *       400: { $ref: '#/components/responses/CartInvalid' }
 *       404: { $ref: '#/components/responses/CartNotFound' }
 * /api/carts/{cartId}/items/{productId}:
 *   parameters:
 *     - $ref: '#/components/parameters/CartId'
 *     - $ref: '#/components/parameters/CartProductId'
 *   put:
 *     tags: [Carts]
 *     summary: Set the quantity of an existing cart item
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [quantity]
 *             properties:
 *               quantity: { type: integer, minimum: 1, maximum: 999 }
 *     responses:
 *       200: { $ref: '#/components/responses/CartResponse' }
 *       400: { $ref: '#/components/responses/CartInvalid' }
 *       404: { $ref: '#/components/responses/CartNotFound' }
 *   delete:
 *     tags: [Carts]
 *     summary: Remove an item from the cart
 *     responses:
 *       200: { $ref: '#/components/responses/CartResponse' }
 *       400: { $ref: '#/components/responses/CartInvalid' }
 *       404: { $ref: '#/components/responses/CartNotFound' }
 * /api/carts/{cartId}/checkout:
 *   parameters:
 *     - $ref: '#/components/parameters/CartId'
 *   post:
 *     tags: [Carts]
 *     summary: Atomically create an order and clear its cart
 *     security: [{ CustomerSession: [] }]
 *     description: Sign in and use your account cart. Reuse checkoutId on retries to recover the same receipt without another order. No payment or email is sent.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CheckoutRequest' }
 *     responses:
 *       201:
 *         description: Order placed, or original receipt returned on retry
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/CheckoutReceipt' }
 *       400: { $ref: '#/components/responses/CartInvalid' }
 *       401: { description: Sign in before placing an order }
 *       404: { $ref: '#/components/responses/CartNotFound' }
 *       409:
 *         description: Empty cart, changed version or price, or checkout ID already used by another cart
 * /api/carts/{cartId}/checkouts/{checkoutId}:
 *   parameters:
 *     - $ref: '#/components/parameters/CartId'
 *     - in: path
 *       name: checkoutId
 *       required: true
 *       schema: { type: string, format: uuid }
 *   get:
 *     tags: [Carts]
 *     summary: Retrieve a saved order confirmation
 *     security: [{ CustomerSession: [] }]
 *     responses:
 *       200:
 *         description: Immutable order receipt
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/CheckoutReceipt' }
 *       400: { $ref: '#/components/responses/CartInvalid' }
 *       404: { $ref: '#/components/responses/CartNotFound' }
 */
import express from 'express';
import { getDatabase } from '../db/sqlite';
import { CheckoutRequest, DeliveryDetails } from '../models/cart';
import { CartsRepository } from '../repositories/cartsRepo';
import { ValidationError } from '../utils/errors';
import { currentUser, protectOrigin, requireUser } from '../utils/auth';

const router = express.Router();
router.use(protectOrigin);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new ValidationError('A valid UUID is required');
  return value.toLowerCase();
}

function integer(value: unknown, name: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ValidationError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('A JSON object is required');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((field) => !fields.includes(field))) {
    throw new ValidationError('Unknown request fields are not allowed');
  }
  return body;
}

function checkoutRequest(value: unknown): CheckoutRequest {
  const body = object(value, ['checkoutId', 'expectedVersion', 'expectedTotalCents', 'branchId', 'delivery']);
  const fields: (keyof DeliveryDetails)[] = ['name', 'email', 'address', 'city', 'postalCode', 'country'];
  const delivery = object(body.delivery, fields);
  const clean: DeliveryDetails = { name: '', email: '', address: '', city: '', postalCode: '', country: '' };
  for (const field of fields) {
    const text = delivery[field];
    const maximum = field === 'address' ? 500 : field === 'email' ? 254 : field === 'postalCode' ? 32 : 120;
    if (typeof text !== 'string' || !text.trim() || text.trim().length > maximum) {
      throw new ValidationError(`delivery.${field} is required and must be at most ${maximum} characters`);
    }
    clean[field] = text.trim();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) throw new ValidationError('A valid delivery email is required');
  return {
    checkoutId: uuid(body.checkoutId),
    expectedVersion: integer(body.expectedVersion, 'expectedVersion', 0),
    expectedTotalCents: integer(body.expectedTotalCents, 'expectedTotalCents', 0),
    branchId: integer(body.branchId, 'branchId'),
    delivery: clean,
  };
}

router.param('cartId', (req, _res, next, value: string) => {
  try { req.params.cartId = uuid(value); next(); } catch (error) { next(error); }
});

router.get('/:cartId', async (req, res, next) => {
  try {
    const repo = new CartsRepository((await getDatabase()).db, await currentUser(req));
    res.json(repo.find(uuid(req.params.cartId)));
  } catch (error) { next(error); }
});

router.post('/:cartId/items', async (req, res, next) => {
  try {
    const body = object(req.body, ['productId', 'quantity']);
    const repo = new CartsRepository((await getDatabase()).db, await currentUser(req));
    res.json(repo.changeItem(uuid(req.params.cartId), integer(body.productId, 'productId'),
      integer(body.quantity, 'quantity', 1, 999), true));
  } catch (error) { next(error); }
});

router.put('/:cartId/items/:productId', async (req, res, next) => {
  try {
    const body = object(req.body, ['quantity']);
    const repo = new CartsRepository((await getDatabase()).db, await currentUser(req));
    res.json(repo.changeItem(uuid(req.params.cartId), integer(Number(req.params.productId), 'productId'),
      integer(body.quantity, 'quantity', 1, 999), false));
  } catch (error) { next(error); }
});

router.delete('/:cartId/items/:productId', async (req, res, next) => {
  try {
    const repo = new CartsRepository((await getDatabase()).db, await currentUser(req));
    res.json(repo.deleteItem(uuid(req.params.cartId), integer(Number(req.params.productId), 'productId')));
  } catch (error) { next(error); }
});

router.post('/:cartId/checkout', async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const body = checkoutRequest(req.body);
    const repo = new CartsRepository((await getDatabase()).db, user);
    res.status(201).json(repo.checkout(uuid(req.params.cartId), body));
  } catch (error) { next(error); }
});

router.get('/:cartId/checkouts/:checkoutId', async (req, res, next) => {
  try {
    const repo = new CartsRepository((await getDatabase()).db, await requireUser(req));
    res.json(repo.receipt(uuid(req.params.cartId), uuid(req.params.checkoutId)));
  } catch (error) { next(error); }
});

export default router;
