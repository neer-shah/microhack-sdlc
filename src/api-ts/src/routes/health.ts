import { Router } from 'express';
import { getDatabase } from '../db/sqlite';

const router = Router();

/**
 * @swagger
 * /api/health/live:
 *   get:
 *     summary: Process liveness (does not query dependencies)
 *     responses:
 *       200: { description: Process is responding }
 * /api/health/ready:
 *   get:
 *     summary: Readiness including database schema availability
 *     responses:
 *       200: { description: Database and required tables are accessible }
 *       503: { description: Database is unavailable or not initialized }
 */
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/ready', async (_req, res) => {
  try {
    const db = await getDatabase();
    await db.get('SELECT product_id FROM products LIMIT 1');
    await db.get('SELECT user_id FROM users LIMIT 1');
    await db.get('SELECT cart_id FROM carts LIMIT 1');
    res.json({ status: 'ready', checks: { database: 'ok' } });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'readiness_failed',
      message: error instanceof Error ? error.message : String(error),
    }));
    res.status(503).json({ status: 'not_ready', checks: { database: 'unavailable' } });
  }
});

export default router;
