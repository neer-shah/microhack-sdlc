# OctoSupply API (TypeScript)

Express + TypeScript reference implementation of the OctoSupply API. The C#, Python, and Java variants are ports of this service.

## Run

```bash
npm install
npm run dev
```

Default API URL: `http://localhost:3000`

## Environment

- `PORT` (default: `3000`)
- `DB_FILE` (default: `./data/app.db`)
- `API_CORS_ORIGINS` (comma-separated override; optional)
- `DB_ENABLE_WAL` (enable WAL mode; default: `true`)
- `DB_FOREIGN_KEYS` (enforce foreign keys; default: `true`)
- `DB_TIMEOUT` (busy timeout in ms; default: `30000`)

## Database

On startup, the API applies SQL migrations from:

- `../database/migrations/*.sql`

and seeds from:

- `../database/seed/*.sql`

## OpenAPI

- OpenAPI JSON: `http://localhost:3000/api-docs.json`
- Swagger UI: `http://localhost:3000/api-docs`

## Guest cart and checkout

### Customer accounts

Migration `004_add_customer_accounts.sql` adds customers, password hashes,
hashed sessions, login throttling, and ownership of carts/orders.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | `{name,email,password,guestCartId?}`; register and sign in |
| POST | `/api/auth/login` | `{email,password,guestCartId?}`; sign in and merge guest cart |
| GET | `/api/auth/me` | Current `{user,cartId}` or 401 |
| POST | `/api/auth/logout` | Revoke session and clear cookie |
| GET | `/api/me/orders` | Current user's latest 100 checkout receipts |
| GET | `/api/me/orders/{id}` | Current user's receipt or 404 |

Emails are normalized to lowercase and unique; passwords are 12-128 characters,
salted and hashed with scrypt (N=16384,r=8,p=1,64-byte key). Only a SHA-256
hash of each random session token is persisted. Cookies are HttpOnly,
SameSite=Lax, scoped to `/api`, and last seven days. Set `NODE_ENV=production`
or `APP_ENV=production` to require Secure cookies over HTTPS. Browser API calls
must use credentials and a same-site frontend/API hostname. The server rejects
unsafe requests from origins outside `API_CORS_ORIGINS` (or development defaults).
Login is throttled after 10 failed attempts per email/client IP in 15 minutes.

New users are always customers. The old frontend email-domain admin shortcut
is removed; privileged roles require deliberate database administration.
There is no email verification, password reset or account deletion flow yet.

Account carts are private to their owner. Login/register merges guest items
atomically and marks the source guest cart consumed. Overflow above 999 of a
product aborts the merge without losing items. Checkout requires the owner's
session and account cart, and records the user ID on the order. Receipts and
order history require the matching owner. Legacy `/api/orders` and
`/api/order-details` are authenticated, customer reads are owner-filtered, and
writes require a real admin role; customers place orders through checkout.
Older anonymous orders are not automatically claimed by newly registered users.

The shared migration `003_add_carts.sql` adds SQLite-backed carts, cart items,
and immutable checkout receipts. The frontend stores an unguessable guest cart
UUID in browser local storage; signed-in users use their private account cart.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/carts/{cartId}` | Fetch cart; an unused UUID returns an empty cart |
| POST | `/api/carts/{cartId}/items` | Add `{productId, quantity}` to existing quantity |
| PUT | `/api/carts/{cartId}/items/{productId}` | Set `{quantity}` |
| DELETE | `/api/carts/{cartId}/items/{productId}` | Delete an item |
| POST | `/api/carts/{cartId}/checkout` | Place an order atomically |
| GET | `/api/carts/{cartId}/checkouts/{checkoutId}` | Retrieve a saved receipt |

Quantities must be integers from 1 to 999. Prices and discounts come from the
catalog; unit prices are rounded to USD cents before multiplying by quantity.
Unknown request fields, including client-supplied prices, are rejected.

Checkout accepts `checkoutId` (a UUID reused for retries), `branchId`,
`expectedVersion`, `expectedTotalCents`, and `delivery` with `name`, `email`,
`address`, `city`, `postalCode`, and `country`. The API rejects empty or stale
carts with 409. It creates the order, order lines and receipt and clears the cart
in one transaction; failed writes leave the cart intact. Reusing the checkout
UUID returns the original receipt without creating another order or consuming
newly added items.

Checkout records delivery information but does **not** process payment, send
email, charge shipping/tax, reserve stock, or arrange delivery. Guest cart IDs
act as access capabilities: do not share them. Receipts require the owner's
authenticated session. Production use still requires retention/cleanup and
appropriate handling of delivery data.

## Tests

Run TypeScript tests from the `src/` directory:

```bash
make test-ts
```
