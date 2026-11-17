# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project context

A portfolio/learning e-commerce site built step by step for a **coding beginner**. The user communicates in Korean, so replies and code comments are written in Korean, explaining concepts plainly. Build it incrementally: one step at a time, with a working, verifiable result after each step.

Roadmap: 0 setup ✅ → 1 product list/detail ✅ → 2 cart ✅ → 3 DB (Prisma + SQLite) ✅ → 4 GitHub login (Auth.js) ✅ → 5 order + Toss Payments **test mode** ✅ → 6 admin page (optional) → 7 deploy to Vercel (swap SQLite for Turso/Neon).

## Commands

Node is installed at `C:\Program Files\nodejs`. Shells opened before the install may not have it on PATH. If so, run `export PATH="/c/Program Files/nodejs:$PATH"` (bash) first.

- `npm run dev`: dev server at http://localhost:3000
- `npm run build`: production build. The route table shows which routes are static (○) and which are dynamic (ƒ).
- `npm run lint`: ESLint. It includes `react-hooks/set-state-in-effect`, which rejects `setState` called directly inside `useEffect`.
- `npx tsc --noEmit`: type-check
- `npm run db:migrate`: `prisma migrate dev && prisma generate`. Run it after editing `prisma/schema.prisma`. In Prisma 7, `migrate` does **not** regenerate the client on its own.
  - `migrate dev` waits on an interactive prompt when a migration has data-loss warnings, and hangs in a non-interactive shell. Instead, run `prisma migrate dev --create-only --name x < /dev/null`, review the SQL, then run `prisma migrate deploy` and `prisma generate`.
  - A hung migrate leaves `schema-engine` processes holding the lock on `dev.db` ("database is locked"). Stop those processes before retrying.
- `npm run db:seed`: seeds masters (season/category/color/size/material/manufacturer/care symbol) + 6 sample styles (15 colors, 47 SKUs); skips if any `Style` exists
  - `--create-only` also refuses to run in a non-interactive shell when there are data-loss warnings. Generate SQL with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<ts>_<name>/migration.sql`, edit it, then `migrate deploy` + `generate`.
- `npm run db:studio`: GUI for viewing and editing the DB

There is no test framework yet. Verify changes with a build plus `next start` and curl, or in the browser.

## Stack-specific gotchas

- **Next.js 16 / React 19**: see AGENTS.md above and read `node_modules/next/dist/docs/` before using unfamiliar APIs.
  - Page `params` is a Promise. Use the global `PageProps<"/route/[id]">` / `LayoutProps<"/">` types.
- **Prisma 7**:
  - The config file is `prisma7.config.ts`, not `prisma.config.ts`. It holds `DATABASE_URL` (via dotenv) and the seed command (`tsx prisma/seed.ts`).
  - The client is generated into `src/generated/prisma/` (gitignored) and imported from `@/generated/prisma/client`, not `@prisma/client`.
  - Client construction requires a driver adapter (`@prisma/adapter-better-sqlite3`). Always use the singleton exported from `src/lib/prisma.ts`.
  - `.agents/skills/prisma-*` contain Prisma's own reference docs, which are useful for Prisma 7 APIs.
- **npm allowScripts**: npm here does not run package install scripts unless they are approved. `better-sqlite3`, `@prisma/engines` and `esbuild` are approved in `package.json` `allowScripts`. A new native dependency needs `npm approve-scripts <pkg>`.
- **Tailwind v4**: configured in `src/app/globals.css` with `@import "tailwindcss"`; there is no tailwind.config. The site is light-theme only; the dark-mode media query was removed on purpose.

## Architecture

- **Data flow**: pages under `src/app` are async server components that query Prisma directly. Every page that reads the DB sets `export const dynamic = "force-dynamic"` so that DB changes show up without a rebuild.
- **Cart lives only in the browser**:
  - `src/context/CartContext.tsx` stores `{ skuId: number, quantity }[]` in localStorage under the key `my-shop-cart-v3`. It reads the cart through `useSyncExternalStore` (a module-level store with a cached snapshot and a cross-tab `storage` listener), not `useEffect`. Keep that pattern when changing it.
  - `CartProvider` wraps everything in `src/app/layout.tsx`, and components access the cart with `useCart()`.
  - The server does not know what is in the cart. So `app/cart/page.tsx` (server) loads SKUs via `getCartSkus()` (`lib/catalog.ts`, flattens style/color/size into `CartSku`) and passes them to `components/CartView.tsx` (client), which joins cart items to SKUs.
- **Schema** (`prisma/schema.prisma`):
  - **Product domain (B안, 3 levels)**: `Style` (one detail page, URL `/products/[code]` = `styleCode`) → `StyleColor` (per-color images/status, `sortOrder` 0 = main color, `?color=BK` selects) → `Sku` (color × size; cart/order unit; `stock` is temporary until the inventory step). Masters: `Season`, `Category` (tree: `parentId` + `path` `/1/4/`, gender-neutral; gender is `Style.gender`), `Color` (`code`, `hex`, `family`), `SizeGroup`/`Size` (`sortOrder`). Masters also: `Material` (StyleMaterial.materialId — never free text), `Manufacturer`, `CareSymbol`. Details: `StyleColorImage`, `StyleMaterial`, `SizeMeasurement`, `ModelWear`, `StyleNotice` (JSON `[{label,value}]`), `StyleCare` (N:M), `StyleWearSeason` (N:M to enum), `StyleDetailBlock` (TEXT/IMAGE/VIDEO blocks by sortOrder). `Style.maxQtyPerOrder` is a per-order limit summed across all SKUs of the style — enforced by `findQtyLimitViolation()` in `lib/cart-rules.ts` (client-safe, shared by CartView and `createOrder`); `preorderShipDate`, `metaTitle`/`metaDescription` (used in `generateMetadata`). `Style.listPrice/salePrice` are temporary until the pricing step.
  - "Sold out" is never a status; it is derived from SKU stock. Sellable = `sellableStyleWhere()` / `sellableColorWhere` / `isStyleSellable()` in `lib/catalog.ts` (status ON_SALE + isDisplayed + not soft-deleted + sale window). Display labels for enums live in `lib/product-labels.ts` (client-safe).
  - Images are placeholder SVGs from `/api/placeholder?bg=&icon=&text=` stored as `StyleColorImage.url`; swap for real URLs later. `<img>` is used with an eslint-disable for `@next/next/no-img-element`.
  - `Order` (`status`: `PENDING` → `PAID`) has many `OrderItem`.
  - `OrderItem` references `skuId` and snapshots `price`, `styleCode`, `skuCode`, `styleName`, `colorName`, `sizeName`, `imageUrl` at order time; order pages read these snapshots, not the live product. Order totals are always calculated on the server from DB prices, never from amounts the client sends.
- **Payment flow** (Toss Payments widget SDK v2, using the public docs test keys in `.env`: `NEXT_PUBLIC_TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`):
  1. Cart → `/checkout`, which requires login. `components/CheckoutView.tsx` renders the widget once; a ref guards against StrictMode's double effect run.
  2. The pay button calls the server action `createOrder` (`app/checkout/actions.ts`). It validates the cart, computes the total from DB prices, and creates a `PENDING` order with a random `paymentOrderId`.
  3. The client calls `widgets.setAmount(serverAmount)`, then `requestPayment`.
  4. Toss redirects to `/api/payments/confirm` (route handler). It checks order ownership and that the amount equals `order.totalPrice`, then calls `confirmPayment` (`lib/toss.ts`, secret key, server only), marks the order `PAID` and redirects to `/checkout/complete` (which clears the cart via `ClearCart`). Failures redirect to `/checkout/fail?message=`.
  - Abandoned checkouts leave `PENDING` orders behind; this is expected.
- **Auth** (`src/auth.ts`):
  - Auth.js v5 (`next-auth@5.0.0-beta.32`, pinned) with the Prisma adapter and **database sessions**. The cookie `authjs.session-token` maps to a `Session` row.
  - Env vars in `.env`: `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`. The GitHub OAuth App callback is `http://localhost:3000/api/auth/callback/github`.
  - Under `next start` (not dev, not Vercel), you must set `AUTH_TRUST_HOST=true`, or Auth.js throws UntrustedHost.
  - Server components call `auth()`. The `session` callback adds `session.user.id`.
  - When filtering by user, check that the id is defined first. A Prisma `where: { userId: undefined }` means no filter.
  - To test logged-in pages without GitHub, insert `User` + `Session` rows and send the cookie `authjs.session-token=<token>`.
- `src/lib/format.ts`: `formatPrice()` turns a price into a KRW string, e.g. `19,000원`.
