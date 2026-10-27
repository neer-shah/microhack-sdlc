import type Database from 'better-sqlite3';
import { Cart, CartItem, CheckoutReceipt, CheckoutRequest } from '../models/cart';
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from '../utils/errors';
import { UnauthorizedError } from '../utils/errors';
import { Customer } from '../models/auth';

interface ItemRow {
  product_id: number;
  name: string;
  img_name: string | null;
  quantity: number;
  price: number;
  discount: number | null;
}

export class CartsRepository {
  constructor(private readonly db: Database.Database, private readonly user: Customer | null = null) {}

  find(cartId: string): Cart {
    this.authorize(cartId);
    const version = this.db.prepare('SELECT version FROM carts WHERE cart_id = ?')
      .get(cartId) as { version: number } | undefined;
    const rows = this.db.prepare(`
      SELECT p.product_id, p.name, p.img_name, i.quantity, p.price, p.discount
      FROM cart_items i JOIN products p ON p.product_id = i.product_id
      WHERE i.cart_id = ? ORDER BY p.product_id
    `).all(cartId) as ItemRow[];
    const items: CartItem[] = rows.map((row) => {
      const discount = row.discount ?? 0;
      const unitPriceCents = Math.floor(row.price * (1 - discount) * 100 + 0.5);
      if (!Number.isFinite(row.price) || row.price < 0 ||
          !Number.isFinite(discount) || discount < 0 || discount > 1 ||
          !Number.isSafeInteger(unitPriceCents * row.quantity)) {
        throw new DatabaseError(`Invalid catalog price for product ${row.product_id}`);
      }
      return {
        productId: row.product_id, name: row.name, imgName: row.img_name,
        quantity: row.quantity, unitPriceCents, lineTotalCents: unitPriceCents * row.quantity,
      };
    });
    const totalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
    if (!Number.isSafeInteger(totalCents)) throw new DatabaseError('Cart total is too large');
    return {
      cartId, version: version?.version ?? 0, items, totalCents,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }

  changeItem(cartId: string, productId: number, quantity: number, add: boolean): Cart {
    return this.db.transaction(() => {
      this.authorize(cartId);
      if (!this.db.prepare('SELECT 1 FROM products WHERE product_id = ?').get(productId)) {
        throw new NotFoundError('Product', productId);
      }
      const current = this.db.prepare('SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?')
        .get(cartId, productId) as { quantity: number } | undefined;
      if (!add && !current) throw new NotFoundError('Cart item', productId);
      const next = add ? (current?.quantity ?? 0) + quantity : quantity;
      if (!Number.isInteger(next) || next < 1 || next > 999) {
        throw new ValidationError('quantity must be between 1 and 999');
      }
      this.db.prepare('INSERT OR IGNORE INTO carts (cart_id) VALUES (?)').run(cartId);
      this.db.prepare(`
        INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)
        ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity
      `).run(cartId, productId, next);
      this.bumpVersion(cartId);
      return this.find(cartId);
    }).immediate();
  }

  deleteItem(cartId: string, productId: number): Cart {
    return this.db.transaction(() => {
      this.authorize(cartId);
      const result = this.db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?')
        .run(cartId, productId);
      if (!result.changes) throw new NotFoundError('Cart item', productId);
      this.bumpVersion(cartId);
      return this.find(cartId);
    }).immediate();
  }

  receipt(cartId: string, checkoutId: string): CheckoutReceipt {
    if (!this.user) throw new UnauthorizedError();
    const row = this.db.prepare(`
      SELECT c.receipt_json FROM cart_checkouts c JOIN orders o ON o.order_id = c.order_id
      WHERE c.cart_id = ? AND c.checkout_id = ? AND o.user_id = ?
    `).get(cartId, checkoutId, this.user.userId) as { receipt_json: string } | undefined;
    if (!row) throw new NotFoundError('Checkout', checkoutId);
    return JSON.parse(row.receipt_json) as CheckoutReceipt;
  }

  checkout(cartId: string, request: CheckoutRequest): CheckoutReceipt {
    const user = this.user;
    if (!user) throw new UnauthorizedError();
    return this.db.transaction(() => {
      this.authorize(cartId);
      const owner = this.db.prepare('SELECT user_id FROM carts WHERE cart_id = ?').get(cartId) as { user_id: number | null } | undefined;
      if (owner?.user_id !== user.userId) throw new ConflictError('Sign in and merge your guest cart before checking out');
      const previous = this.db.prepare('SELECT cart_id FROM cart_checkouts WHERE checkout_id = ?')
        .get(request.checkoutId) as { cart_id: string } | undefined;
      if (previous) {
        if (previous.cart_id !== cartId) throw new ConflictError('Checkout ID already used');
        return this.receipt(cartId, request.checkoutId);
      }
      const cart = this.find(cartId);
      if (!cart.items.length) throw new ConflictError('Your cart is empty');
      if (cart.version !== request.expectedVersion || cart.totalCents !== request.expectedTotalCents) {
        throw new ConflictError('Your cart or its prices changed. Review it before placing the order.');
      }
      if (!this.db.prepare('SELECT 1 FROM branches WHERE branch_id = ?').get(request.branchId)) {
        throw new NotFoundError('Branch', request.branchId);
      }
      const placedAt = new Date().toISOString();
      const order = this.db.prepare(`
        INSERT INTO orders (branch_id, order_date, name, description, status, user_id)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `).run(request.branchId, placedAt, request.delivery.name, JSON.stringify(request.delivery), user.userId);
      const orderId = Number(order.lastInsertRowid);
      const insert = this.db.prepare(`
        INSERT INTO order_details (order_id, product_id, quantity, unit_price, notes)
        VALUES (?, ?, ?, ?, '')
      `);
      for (const item of cart.items) {
        insert.run(orderId, item.productId, item.quantity, item.unitPriceCents / 100);
      }
      const receipt: CheckoutReceipt = {
        checkoutId: request.checkoutId, cartId, orderId, placedAt, delivery: request.delivery,
        items: cart.items, totalCents: cart.totalCents, itemCount: cart.itemCount,
      };
      this.db.prepare(`
        INSERT INTO cart_checkouts (checkout_id, cart_id, order_id, receipt_json) VALUES (?, ?, ?, ?)
      `).run(request.checkoutId, cartId, orderId, JSON.stringify(receipt));
      this.db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cartId);
      this.bumpVersion(cartId);
      return receipt;
    }).immediate();
  }

  private bumpVersion(cartId: string): void {
    this.db.prepare('UPDATE carts SET version = version + 1 WHERE cart_id = ?').run(cartId);
  }

  history(orderId?: number): CheckoutReceipt[] {
    if (!this.user) throw new UnauthorizedError();
    const rows = this.db.prepare(`
      SELECT c.receipt_json FROM cart_checkouts c JOIN orders o ON o.order_id = c.order_id
      WHERE o.user_id = ? ${orderId === undefined ? '' : 'AND o.order_id = ?'}
      ORDER BY o.order_date DESC, o.order_id DESC LIMIT 100
    `).all(...(orderId === undefined ? [this.user.userId] : [this.user.userId, orderId])) as { receipt_json: string }[];
    return rows.map((row) => JSON.parse(row.receipt_json) as CheckoutReceipt);
  }

  private authorize(cartId: string): void {
    const row = this.db.prepare('SELECT user_id, merged_into FROM carts WHERE cart_id = ?')
      .get(cartId) as { user_id: number | null; merged_into: string | null } | undefined;
    if (row?.merged_into) throw new NotFoundError('Cart', cartId);
    if (row?.user_id !== null && row !== undefined) {
      if (!this.user) throw new UnauthorizedError();
      if (row.user_id !== this.user.userId) throw new NotFoundError('Cart', cartId);
    }
  }
}
