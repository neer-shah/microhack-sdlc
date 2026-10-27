/**
 * @swagger
 * tags:
 *   - name: Accounts
 *     description: Database-backed customer accounts and seven-day HttpOnly cookie sessions
 * /api/auth/register:
 *   post:
 *     tags: [Accounts]
 *     summary: Register a customer, merge their guest cart and sign in
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Registration' }
 *     responses:
 *       201:
 *         description: Account created and session cookie set
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       400: { description: Invalid registration fields }
 *       403: { description: Disallowed request Origin }
 *       404: { description: Guest cart is owned by someone else or already consumed }
 *       409: { description: Duplicate email or merged quantity would exceed 999 }
 * /api/auth/login:
 *   post:
 *     tags: [Accounts]
 *     summary: Sign in and merge the guest cart atomically
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/LoginCredentials' }
 *     responses:
 *       200:
 *         description: Session cookie set and account cart returned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       400: { description: Invalid credentials format }
 *       401: { description: Incorrect email or password }
 *       403: { description: Disallowed request Origin }
 *       404: { description: Guest cart cannot be merged into this account }
 *       409: { description: Merged quantity would exceed 999 }
 *       429: { description: Ten failed logins in 15 minutes for this email and client IP }
 * /api/auth/me:
 *   get:
 *     tags: [Accounts]
 *     summary: Restore the current user session and account cart
 *     security: [{ CustomerSession: [] }]
 *     responses:
 *       200:
 *         description: Current customer
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthSession' }
 *       401: { description: Missing or expired session }
 * /api/auth/logout:
 *   post:
 *     tags: [Accounts]
 *     summary: Revoke the current session and clear its cookie
 *     responses:
 *       204: { description: Signed out }
 *       403: { description: Disallowed request Origin }
 */
import express from 'express';
import { getDatabase } from '../db/sqlite';
import { Credentials } from '../models/auth';
import { AuthRepository } from '../repositories/authRepo';
import { UnauthorizedError, ValidationError } from '../utils/errors';
import { protectOrigin, sessionCookieOptions, sessionToken } from '../utils/auth';

const router = express.Router();
router.use(protectOrigin);

function credentials(value: unknown, register: boolean): Credentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('A JSON object is required');
  const body = value as Record<string, unknown>;
  const allowed = register ? ['name', 'email', 'password', 'guestCartId'] : ['email', 'password', 'guestCartId'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new ValidationError('Unknown request fields are not allowed');
  if (typeof body.email !== 'string' || body.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    throw new ValidationError('A valid email is required');
  }
  if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
    throw new ValidationError('Password must contain 12 to 128 characters');
  }
  if (register && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120)) {
    throw new ValidationError('Name is required and must be at most 120 characters');
  }
  if (body.guestCartId !== undefined && (typeof body.guestCartId !== 'string' ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.guestCartId))) {
    throw new ValidationError('guestCartId must be a UUID');
  }
  return {
    email: body.email.trim().toLowerCase(), password: body.password,
    name: register ? (body.name as string).trim() : undefined,
    guestCartId: typeof body.guestCartId === 'string' ? body.guestCartId.toLowerCase() : undefined,
  };
}

for (const action of ['register', 'login'] as const) {
  router.post(`/${action}`, async (req, res, next) => {
    try {
      const body = credentials(req.body, action === 'register');
      const repo = new AuthRepository((await getDatabase()).db);
      const result = action === 'register' ? await repo.register(body) : await repo.login(body, req.ip ?? '');
      repo.logout(sessionToken(req));
      res.cookie('octocat_session', result.token, { ...sessionCookieOptions(), maxAge: 604800000 });
      res.set('Cache-Control', 'no-store').status(action === 'register' ? 201 : 200).json({ user: result.user, cartId: result.cartId });
    } catch (error) { next(error); }
  });
}

router.get('/me', async (req, res, next) => {
  try {
    const session = new AuthRepository((await getDatabase()).db).current(sessionToken(req));
    if (!session) throw new UnauthorizedError();
    res.set('Cache-Control', 'no-store').json(session);
  } catch (error) { next(error); }
});

router.post('/logout', async (req, res, next) => {
  try {
    new AuthRepository((await getDatabase()).db).logout(sessionToken(req));
    res.clearCookie('octocat_session', sessionCookieOptions()).status(204).send();
  } catch (error) { next(error); }
});

export default router;
