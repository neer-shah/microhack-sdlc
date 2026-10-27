import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AuthSession, Credentials, Customer } from '../models/auth';
import { ConflictError, DatabaseError, NotFoundError, UnauthorizedError, ValidationError } from '../utils/errors';

const sessionLifetime = 604800;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
interface UserRow { user_id: number; name: string; email: string; role: Customer['role']; password_hash: string }
const customer = (row: UserRow): Customer => ({ userId: row.user_id, name: row.name, email: row.email, role: row.role });

export class AuthRepository {
  constructor(private readonly db: Database.Database) {}

  current(token: string | undefined): AuthSession | null {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const row = this.db.prepare(`
      SELECT u.* FROM auth_sessions s JOIN users u ON u.user_id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hash(token), Math.floor(Date.now() / 1000)) as UserRow | undefined;
    if (!row) return null;
    return { user: customer(row), cartId: this.accountCart(row.user_id) };
  }

  async register(credentials: Credentials): Promise<AuthSession & { token: string }> {
    const name = credentials.name;
    if (!name) throw new ValidationError('Name is required');
    const salt = randomBytes(16);
    const passwordHash = `scrypt$${salt.toString('hex')}$${(await derive(credentials.password, salt)).toString('hex')}`;
    return this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(credentials.email)) {
        throw new ConflictError('An account with this email already exists');
      }
      const inserted = this.db.prepare(`
        INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)
      `).run(name, credentials.email, passwordHash, new Date().toISOString());
      const user: Customer = { userId: Number(inserted.lastInsertRowid), name, email: credentials.email, role: 'customer' };
      return this.start(user, credentials.guestCartId);
    }).immediate();
  }

  async login(credentials: Credentials, ip: string): Promise<AuthSession & { token: string }> {
    const attemptKey = hash(`${credentials.email}|${ip}`);
    const now = Math.floor(Date.now() / 1000);
    const attempt = this.db.prepare('SELECT attempts, window_start FROM auth_attempts WHERE attempt_key = ?')
      .get(attemptKey) as { attempts: number; window_start: number } | undefined;
    if (attempt && attempt.window_start > now - 900 && attempt.attempts >= 10) {
      throw new DatabaseError('Too many login attempts. Try again in 15 minutes.', 'RATE_LIMITED', 429);
    }
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(credentials.email) as UserRow | undefined;
    const encoded = row?.password_hash.split('$');
    const salt = encoded?.[1] && /^[0-9a-f]{32}$/.test(encoded[1]) ? Buffer.from(encoded[1], 'hex') : Buffer.alloc(16);
    const actual = await derive(credentials.password, salt);
    const expected = encoded?.[2] && /^[0-9a-f]{128}$/.test(encoded[2]) ? Buffer.from(encoded[2], 'hex') : Buffer.alloc(64);
    if (!timingSafeEqual(actual, expected) || !row || encoded?.[0] !== 'scrypt') {
      this.db.prepare(`
        INSERT INTO auth_attempts (attempt_key, attempts, window_start) VALUES (?, 1, ?)
        ON CONFLICT(attempt_key) DO UPDATE SET
        attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END,
        window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
      `).run(attemptKey, now, now - 900, now - 900);
      throw new UnauthorizedError('Email or password is incorrect');
    }
    return this.db.transaction(() => {
      const result = this.start(customer(row), credentials.guestCartId);
      this.db.prepare('DELETE FROM auth_attempts WHERE attempt_key = ?').run(attemptKey);
      return result;
    }).immediate();
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hash(token));
  }

  private start(user: Customer, guestCartId?: string): AuthSession & { token: string } {
    const cartId = this.accountCart(user.userId);
    if (guestCartId && guestCartId !== cartId) this.merge(cartId, guestCartId);
    const token = randomBytes(32).toString('hex');
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM auth_attempts WHERE window_start <= ?').run(now - 900);
    this.db.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hash(token), user.userId, now + sessionLifetime);
    return { user, cartId, token };
  }

  private accountCart(userId: number): string {
    const row = this.db.prepare('SELECT cart_id FROM carts WHERE user_id = ? AND merged_into IS NULL')
      .get(userId) as { cart_id: string } | undefined;
    if (row) return row.cart_id;
    const cartId = randomUUID();
    this.db.prepare('INSERT INTO carts (cart_id, user_id) VALUES (?, ?)').run(cartId, userId);
    return cartId;
  }

  private merge(cartId: string, guestId: string): void {
    const source = this.db.prepare('SELECT user_id, merged_into FROM carts WHERE cart_id = ?')
      .get(guestId) as { user_id: number | null; merged_into: string | null } | undefined;
    if (source?.user_id !== null && source !== undefined) throw new NotFoundError('Cart', guestId);
    if (source?.merged_into) {
      if (source.merged_into === cartId) return;
      throw new NotFoundError('Cart', guestId);
    }
    const items = this.db.prepare('SELECT product_id, quantity FROM cart_items WHERE cart_id = ?')
      .all(guestId) as { product_id: number; quantity: number }[];
    for (const item of items) {
      const current = this.db.prepare('SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?')
        .get(cartId, item.product_id) as { quantity: number } | undefined;
      const quantity = (current?.quantity ?? 0) + item.quantity;
      if (quantity > 999) throw new ConflictError('Merging carts would exceed 999 of an item. Reduce your guest quantity and try again.');
      this.db.prepare(`
        INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)
        ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity
      `).run(cartId, item.product_id, quantity);
    }
    this.db.prepare('INSERT OR IGNORE INTO carts (cart_id) VALUES (?)').run(guestId);
    this.db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(guestId);
    this.db.prepare('UPDATE carts SET merged_into = ?, version = version + 1 WHERE cart_id = ?').run(cartId, guestId);
    if (items.length) this.db.prepare('UPDATE carts SET version = version + 1 WHERE cart_id = ?').run(cartId);
  }
}
