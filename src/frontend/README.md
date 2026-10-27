# React + TypeScript + Vite

## Cart and checkout

### Customer accounts and checkout recovery

- `/register` stores a name, normalized unique email and scrypt-hashed password
  in the selected backend's SQLite database. Passwords must contain 12-128
  characters. There is no email verification or password reset yet.
- `/login` uses the real API, not the former demo credential/domain check.
  Sessions use seven-day HttpOnly cookies; no password or session token is
  stored in browser JavaScript storage. New accounts are always customers.
- Guest browsing and carts still work. Sign-in/registration atomically merges
  the guest cart into the account cart, without duplicating a consumed guest
  cart. Signed-in carts follow the account on other devices. Signing out gives
  this browser a fresh guest cart and clears private cached data/drafts.
- You must sign in before placing an order. `/orders` lists your latest 100
  orders, and confirmation pages require their owner's session.
- Delivery fields, branch selection, review and the checkout idempotency ID
  are saved per account in **session storage**. They survive refresh/navigation
  in the same tab, not closing the tab. Guest delivery drafts transfer on
  sign-in; sign-out clears them. No credentials are saved in checkout drafts.
- After an interrupted placement, checkout looks up the saved receipt. If
  the request committed, it opens the original confirmation; otherwise you
  can retry with the same ID. It does not automatically place another order.
- Use the **same hostname** for the frontend and API (`localhost` for both,
  or `127.0.0.1` for both). Different ports are supported by credentialed CORS.
  Unrelated production domains need a same-site proxy/domain arrangement.

Both the TypeScript and Python APIs support the same cart flow:

- Product **Add to Cart** saves items through `/api/carts`.
- The shared `CartProvider` caches server state with React Query. A guest cart
  UUID in local storage preserves the cart across navigation, reloads and
  browser restarts on the same origin. Storage events synchronize mutations
  across tabs; focus refetch and a 15-second refresh also update server changes.
- `/cart` supports increasing/decreasing quantities, deleting items and
  continuing to checkout. The navigation shows the current item count.
- `/checkout` collects delivery details and an ordering branch, then shows an
  itemized review. A changed cart must be reviewed again.
- Placing an order uses an idempotency UUID, authoritative server prices and an
  atomic transaction. Checkout failures retain the review for retry; a lost
  response can be retried without creating a duplicate order.
- `/checkout/confirmation/{cartId}/{checkoutId}` reloads the saved receipt.

There are no real payments, email, shipping fees, tax or stock reservation.
Clearing local storage loses the guest cart identifier; signed-in carts remain
in the account database. Existing orders placed before customer accounts were
introduced are not automatically assigned to any new account.

For browser tests, start the chosen API and frontend using the existing Make
targets, then run `npm run test:e2e -- cart.spec.ts` from this directory. To use
already-running servers, set `PLAYWRIGHT_WEB_SERVER=false` and
`PLAYWRIGHT_BASE_URL` to the frontend origin. The tests use the shared seed
product with ID 1 and create orders, so use an isolated development database.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    'react-x': reactX,
    'react-dom': reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs['recommended-typescript'].rules,
    ...reactDom.configs.recommended.rules,
  },
})
```
