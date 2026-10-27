/**
 * @swagger
 * /api/me/orders:
 *   get:
 *     tags: [Accounts]
 *     summary: Return this customer's latest 100 checkout receipts, newest first
 *     security: [{ CustomerSession: [] }]
 *     responses:
 *       200:
 *         description: Own checkout receipts only
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/CheckoutReceipt' }
 *       401: { description: Missing or expired session }
 * /api/me/orders/{id}:
 *   get:
 *     tags: [Accounts]
 *     summary: Return an order receipt owned by the current customer
 *     security: [{ CustomerSession: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: Own receipt
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/CheckoutReceipt' }
 *       401: { description: Missing or expired session }
 *       404: { description: Order not found or owned by another user }
 */
import express from 'express';
import { getDatabase } from '../db/sqlite';
import { CartsRepository } from '../repositories/cartsRepo';
import { requireUser } from '../utils/auth';
import { NotFoundError, ValidationError } from '../utils/errors';

const router = express.Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/orders', async (req, res, next) => {
  try {
    const user = await requireUser(req);
    res.json(new CartsRepository((await getDatabase()).db, user).history());
  } catch (error) { next(error); }
});
router.get('/orders/:id', async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new ValidationError('orderId must be a positive integer');
    const receipt = new CartsRepository((await getDatabase()).db, user).history(id)[0];
    if (!receipt) throw new NotFoundError('Order', id);
    res.json(receipt);
  } catch (error) { next(error); }
});
export default router;
