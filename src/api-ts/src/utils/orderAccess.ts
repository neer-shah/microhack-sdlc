import type { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/sqlite';
import { requireUser } from './auth';
import { ForbiddenError, NotFoundError } from './errors';
import { mapDatabaseRows, DatabaseRow } from './sql';

export function orderAccess(details: boolean) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await requireUser(req);
      res.set('Cache-Control', 'no-store');
      if (user.role === 'admin') { next(); return; }
      if (req.method !== 'GET') throw new ForbiddenError('Orders can only be placed through authenticated checkout');
      const db = (await getDatabase()).db;
      const id = req.path === '/' ? undefined : Number(req.path.slice(1));
      const rows = details
        ? db.prepare(`SELECT d.* FROM order_details d JOIN orders o ON o.order_id = d.order_id
            WHERE o.user_id = ? ${id === undefined ? '' : 'AND d.order_detail_id = ?'} ORDER BY d.order_detail_id LIMIT 1000`)
          .all(...(id === undefined ? [user.userId] : [user.userId, id]))
        : db.prepare(`SELECT * FROM orders WHERE user_id = ? ${id === undefined ? '' : 'AND order_id = ?'} ORDER BY order_id DESC LIMIT 100`)
          .all(...(id === undefined ? [user.userId] : [user.userId, id]));
      if (id !== undefined && !rows.length) throw new NotFoundError(details ? 'OrderDetail' : 'Order', String(id));
      const result = mapDatabaseRows(rows as DatabaseRow[]);
      res.json(id === undefined ? result : result[0]);
    } catch (error) { next(error); }
  };
}
