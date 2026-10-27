-- Manual rollback requires first exporting checkout receipts and their delivery data.
-- Then drop cart_checkouts, cart_items, and carts in that order.
CREATE TABLE IF NOT EXISTS carts (
    cart_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
);

CREATE TABLE IF NOT EXISTS cart_items (
    cart_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
    PRIMARY KEY (cart_id, product_id),
    FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON cart_items(product_id);

CREATE TABLE IF NOT EXISTS cart_checkouts (
    checkout_id TEXT PRIMARY KEY,
    cart_id TEXT NOT NULL,
    order_id INTEGER NOT NULL,
    receipt_json TEXT NOT NULL,
    FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE RESTRICT,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cart_checkouts_cart_id ON cart_checkouts(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_checkouts_order_id ON cart_checkouts(order_id);
