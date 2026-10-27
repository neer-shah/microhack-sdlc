-- Rollback requires exporting customer credentials, sessions and owned orders first.
-- SQLite column removal requires rebuilding carts and orders with their previous schemas.
-- The migration runner records this version, so ALTER TABLE statements run only once.
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_attempts (
    attempt_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    window_start INTEGER NOT NULL
);

ALTER TABLE carts ADD COLUMN user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE carts ADD COLUMN merged_into TEXT REFERENCES carts(cart_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_user_id ON carts(user_id)
    WHERE user_id IS NOT NULL AND merged_into IS NULL;
CREATE INDEX IF NOT EXISTS idx_carts_merged_into ON carts(merged_into);

ALTER TABLE orders ADD COLUMN user_id INTEGER REFERENCES users(user_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
