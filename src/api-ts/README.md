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

The shared migration `003_add_carts.sql` adds SQLite-backed carts, cart items,
and immutable checkout receipts. The frontend stores an unguessable guest cart
UUID in browser local storage; it is not tied to the demo login.

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
and receipt URLs act as access capabilities: do not share them. Production use
requires authenticated ownership, retention/cleanup, and appropriate handling
of delivery data.

## Tests

Run TypeScript tests from the `src/` directory:

```bash
make test-ts
```
