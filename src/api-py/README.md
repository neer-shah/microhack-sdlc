# OctoSupply API (Python)

FastAPI port of the OctoSupply API.

## Run

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 3000
```

Default API URL: `http://localhost:3000`

## Environment

- `PORT` (used by Makefile/uvicorn command, default `3000`)
- `DB_FILE` (default: `./data/app.db`)
- `API_CORS_ORIGINS` (comma-separated override; optional)
- `DB_MIGRATIONS_DIR` (optional override for migrations directory)
- `APP_ENV=production` or `NODE_ENV=production` enables HTTPS-only session cookies

## Database

On startup, the API applies SQL migrations from:

- `../database/migrations/*.sql`

and seeds from:

- `../database/seed/*.sql`

## OpenAPI

- OpenAPI JSON: `http://localhost:3000/openapi.json`
- Swagger UI: `http://localhost:3000/docs`

## Accounts and sessions

This API uses real database-backed accounts, not simulated login. Apply shared migration
`004_add_customer_accounts.sql` (automatically applied at startup) before using authentication.

- `POST /api/auth/register` accepts `{ "name": "Ada", "email": "ada@example.com",
  "password": "a-long-unique-password", "guestCartId": "<optional canonical UUID>" }`
  and returns `201` with `{ "user": { "userId": 1, "name": "Ada",
  "email": "ada@example.com", "role": "customer" }, "cartId": "<account cart UUID>" }`.
- `POST /api/auth/login` accepts `email`, `password`, and optional `guestCartId`;
  it returns the same shape with `200`.
- `GET /api/auth/me` restores the current session and account cart; it returns `401`
  when the session is missing, revoked, or expired.
- `POST /api/auth/logout` revokes the session and expires the cookie (`204`, including
  for an already expired session). Generate a **fresh guest cart UUID** after logout.

Names are trimmed (1–120 characters); emails are trimmed and lowercased (up to 254).
Passwords are strict strings of 12–128 characters and are never trimmed. Extra fields,
including client-supplied roles or user IDs, are rejected. Registration always creates
a customer; administrator roles can only be assigned through trusted database administration.
Passwords use salted scrypt (`N=16384`, `r=8`, `p=1`, 64-byte output, 16-byte salt).
The portable encoding is `scrypt$<salt hex>$<hash hex>`.

The random 32-byte session token is sent only in the `octocat_session` cookie:
`HttpOnly; Path=/api; SameSite=Lax; Max-Age=604800` (seven days), plus `Secure` in
production. Only its SHA-256 hash is stored in SQLite. Browser clients must send
credentials when using cross-origin requests. Mutations with an `Origin` must match
the CORS allowlist (default localhost port 5137 or HTTPS Codespaces/Container Apps
domains); wildcard origins are not accepted. Requests without `Origin` remain supported
for API clients. Login is limited to 10 failed attempts per normalized email/client IP
per 15 minutes using database-backed counters. Successful login clears the counter.
There is no email verification or password-reset flow yet.

Registration and login atomically merge an optional guest cart into the user's persistent
cart and create the session. Quantities are added; a quantity above 999 rejects the whole
transaction with `409`. A nonexistent guest cart is ignored. A previously merged cart
can be submitted again only by its original destination account (a no-op); all direct
access to merged guest cart IDs returns `404`. Account carts cannot be passed as guest
cart IDs. Failed merges never create an account/session or partially update either cart.

## Carts, authenticated checkout, and previous orders

Guest carts are persisted by UUID and can be shared across browser tabs. Create a UUID in
the client and use it at `GET /api/carts/{cartId}`; an unknown valid UUID returns an
empty cart without storing it. Add with `POST /api/carts/{cartId}/items`
(`{ "productId": 1, "quantity": 2 }`), set quantity with `PUT
/api/carts/{cartId}/items/{productId}`, and remove with `DELETE` on the same item path.
Mutations return the updated cart with its version and server-calculated prices.
Account carts require their owner's valid session (`401` without sign-in, `404` for
another account); guest CRUD remains available without signing in.

**Sign-in is required before placing an order or reading a receipt.** Checkout accepts
a unique `checkoutId`, the cart's `expectedVersion` and
`expectedTotalCents`, a `branchId`, and delivery details at
`POST /api/carts/{cartId}/checkout`. A successful checkout atomically creates the
pending order and its details, saves a receipt, clears the cart, and increments its
version. No payment is collected. Fetch the saved confirmation again with
`GET /api/carts/{cartId}/checkouts/{checkoutId}`; retrying the same checkout ID for
the same cart returns that original receipt.

`GET /api/me/orders` returns the signed-in user's **latest 100** saved
`CheckoutReceipt` objects, newest first. `GET /api/me/orders/{orderId}` returns one
owned receipt or `404`. Receipt prices and delivery data are immutable checkout
snapshots; another user's receipts and pre-account guest orders cannot be claimed.
The existing `/api/orders` and `/api/order-details` GET routes require authentication
and only list a customer's owned records (administrators can read all records).
POST/PUT/DELETE on those legacy routes require a database-backed administrator role.

Checkout and receipt responses retain the existing cart/receipt contract. Clients should
retain the original checkout ID and payload until they receive or re-fetch its saved
receipt, rather than clearing pending checkout state on a network failure.

## Tests

From `src/api-py`:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

Tests use isolated databases under `.test-data` in this project and remove them after
each test; they never alter the application's default `data/app.db`.
