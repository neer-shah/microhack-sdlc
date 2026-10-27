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

## Database

On startup, the API applies SQL migrations from:

- `../database/migrations/*.sql`

and seeds from:

- `../database/seed/*.sql`

## OpenAPI

- OpenAPI JSON: `http://localhost:3000/openapi.json`
- Swagger UI: `http://localhost:3000/docs`

## Guest carts and checkout

Guest carts are persisted by UUID and can be shared across browser tabs. Create a UUID in
the client and use it at `GET /api/carts/{cartId}`; an unknown valid UUID returns an
empty cart without storing it. Add with `POST /api/carts/{cartId}/items`
(`{ "productId": 1, "quantity": 2 }`), set quantity with `PUT
/api/carts/{cartId}/items/{productId}`, and remove with `DELETE` on the same item path.
Mutations return the updated cart with its version and server-calculated prices.

Checkout accepts a unique `checkoutId`, the cart's `expectedVersion` and
`expectedTotalCents`, a `branchId`, and delivery details at
`POST /api/carts/{cartId}/checkout`. A successful checkout atomically creates the
pending order and its details, saves a receipt, clears the cart, and increments its
version. No payment is collected. Fetch the saved confirmation again with
`GET /api/carts/{cartId}/checkouts/{checkoutId}`; retrying the same checkout ID for
the same cart returns that original receipt.
