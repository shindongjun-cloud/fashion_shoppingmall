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
  - `--create-only` also refuses to run in a non-interactive shell when there are data-loss warnings.
- **Migration workflow (required — DB constraints live outside Prisma)**:
  1. `npx prisma migrate diff --config prisma7.config.ts --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<ts>_<name>/migration.sql`
  2. `npm run db:constraints -- prisma/migrations/<ts>_<name>/migration.sql` — injects CHECKs into every `CREATE TABLE "X"`/`"new_X"` and drops/recreates affected triggers (including triggers on *other* tables that read a redefined table; otherwise SQLite aborts the RENAME with "no such table").
  3. Review the SQL (add data-migration statements by hand), **back up dev.db**, then `prisma migrate deploy` + `prisma generate`. SQLite migrations are not rolled back on failure — a failed migration leaves the DB half-applied (restore the backup, fix, regenerate).
  4. `npm run db:verify` — must pass (constraints present and identical to definitions, existing data valid, cross-row business rules). Then `npm test`.
  - Data-migration SQL must write dates as `strftime('%Y-%m-%dT%H:%M:%f+00:00','now')`, never `CURRENT_TIMESTAMP`.
  - When removing a column, remove its constraints from `db-constraints.ts`: SQLite treats an unknown `"name"` as a string literal, so a stale CHECK silently becomes always-false (this broke a migration once). `validateConstraints()` now fails `db:constraints`/`db:verify` on unknown columns.
  - Never edit an applied migration file (checksum). Adding an enum value needs a migration that recreates the table so its enum CHECK is regenerated — `db:verify` reports the stale CHECK.
- `npm run db:verify`: integrity check (see above). `npm test`: `tsx --test "tests/**/*.test.ts"` — `tests/pricing.test.ts` (pure unit tests of `computePrice`) and `tests/db-constraints.test.ts` (raw-SQL invalid writes must be rejected by the DB; runs against dev.db inside rolled-back transactions, needs seeded data), `tests/inventory.test.ts` (commits, so it runs on a temp copy via `tests/helpers/temp-db.ts` — import it first), `tests/inject-constraints.test.ts`.
- `npm run inventory:release-expired`: expire overdue reservations (to be run by cron after deploy). `tests/` is type-checked by `next build` too.
- `npm run db:studio`: GUI for viewing and editing the DB

Tests use Node's built-in runner via tsx (no extra framework). Also verify UI changes with a build plus `next start` and curl, or in the browser.

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

## DB constraints (prisma/db-constraints.ts)

- Prisma can't express CHECK constraints or triggers, so they are defined in `prisma/db-constraints.ts` (single source) and injected into migration SQL by `scripts/inject-constraints.ts`; `scripts/db-verify.ts` checks them. Prisma ignores them (`migrate diff` stays empty), but drops them whenever it recreates a table — hence step 2 of the workflow.
- SQLite specifics handled there: Prisma enums are plain TEXT (auto `IN (...)` CHECK per enum/Boolean field, parsed from schema.prisma); INTEGER columns accept text, so money/stock checks also test `typeof(x) = 'integer'`; dates are stored as TEXT `YYYY-MM-DDTHH:MM:SS.mmm+00:00` (UTC) so text comparison = time comparison — never write `CURRENT_TIMESTAMP` (different format) into date columns; date columns used in comparisons have a format CHECK.
- Cross-row rules are triggers: SKU/measurement/model sizes must belong to the style's size group; style size group can't change once SKUs exist; StyleColor can't move styles; StylePrice periods can't overlap (also guarantees one current price); RATE overrides 1–99; `Category.path`/`depth` are computed by an AFTER INSERT trigger (don't pass them; parent can't change).
- **Sale gate**: a `Style` cannot be inserted as `ON_SALE`; create it as `DRAFT`, add colors/SKUs/images/notice/materials/price, then update to `ON_SALE`. Trigger `Style_sale_ready_upd` rejects the transition (with a specific message) unless there is a current `StylePrice`, a `StyleNotice`, ≥1 sellable color, every sellable color has a SKU and a MAIN image, and materials exist with every part summing to 100. The seed does this in `openSales()` after `seedPricing()`. A notice can't be deleted while ON_SALE (suspend first). Other edits to an ON_SALE style are not re-checked at write time — `db:verify` reports drift.
- **Code consistency**: `StyleColor.code` must equal `styleCode-colorCode`, `Sku.skuCode` must equal `styleColor.code-sizeCode`, `Season.code` = last 2 digits of year + term. `styleCode`/`Color.code`/`Size.code` can't change once used.
- BEFORE triggers fire before CHECK/UNIQUE/FK, so a test meant for one constraint can be pre-empted by a trigger — pick a write only that constraint can reject.
- Delete rules: masters and promotion-target references are `Restrict` (a SetNull'd EXCLUDE target would silently start discounting the excluded style); `StylePrice` is `Restrict` (legal evidence for displayed discount rates).
- `StyleColor (styleId, sortOrder)` and `Size (sizeGroupId, sortOrder)` are unique ("sortOrder 0 = main color" must be unambiguous).

## Inventory (B안: reserve on order → confirm on payment → release/expire)

- Tables: `InventoryLocation` (ONLINE_DC is the only `isOnlineSellable`), `InventoryBalance` (sku × location: `onHand`, `reserved`, `safetyStock`), `InventoryLedger` (append-only; signed `qty` by type; `balanceAfter`), `InventoryReservation` (RESERVED → CONFIRMED | RELEASED(+reason) | EXPIRED, 20-min TTL). `Sku` has no stock column.
- **The app never writes balance numbers.** Insert ledger rows / insert or update reservations; triggers keep `onHand = SUM(ledger)` and `reserved = SUM(RESERVED)`, reject reservations above `onHand − reserved − safetyStock`, and turn CONFIRMED into a SALE ledger row. Balance rows can only be created with zeros (`ensureBalance`); use `recordMovement()` for inbound/adjustments (adjust/defect/manual need a reason).
- `lib/inventory.ts`: `getAvailability` (display; ignores expired-but-unreleased reservations), `reserveOrder`, `releaseOrder`, `releaseExpired`, `ensureOrderReserved` (before Toss confirm: re-reserves expired or <2 min reservations as RENEWED; if stock is gone, Toss is never called), `confirmOrder`, `withBusyRetry` (SQLite `SQLITE_BUSY`/P1008 after ~5 s when two connections write → retry, so the loser gets "재고 부족" instead of an error).
- `lib/checkout.ts`: `placeOrder` (validates, prices, releases the user's previous PENDING orders as SUPERSEDED, creates order + reservations in one transaction), `abandonOrder`, `confirmOrderPayment` (ensure → Toss confirm → finalize; if finalize fails after Toss approved it calls `cancelPayment` and marks the order CANCELED, or CANCEL_FAILED if the refund also failed). Deps are injectable for tests. `app/checkout/actions.ts` and the payment routes are thin wrappers; Toss `failUrl` is `/api/payments/fail` (releases the reservation, then redirects to `/checkout/fail`).
- `Order.status` is still a free string (PENDING/PAID/CANCELED/CANCEL_FAILED) — to be formalized in the order step.

## Architecture

- **Data flow**: pages under `src/app` are async server components that query Prisma directly. Every page that reads the DB sets `export const dynamic = "force-dynamic"` so that DB changes show up without a rebuild.
- **Cart lives only in the browser**:
  - `src/context/CartContext.tsx` stores `{ skuId: number, quantity }[]` in localStorage under the key `my-shop-cart-v3`. It reads the cart through `useSyncExternalStore` (a module-level store with a cached snapshot and a cross-tab `storage` listener), not `useEffect`. Keep that pattern when changing it.
  - `CartProvider` wraps everything in `src/app/layout.tsx`, and components access the cart with `useCart()`.
  - The server does not know what is in the cart. So `app/cart/page.tsx` (server) loads SKUs via `getCartSkus()` (`lib/catalog.ts`, flattens style/color/size into `CartSku`) and passes them to `components/CartView.tsx` (client), which joins cart items to SKUs.
- **Schema** (`prisma/schema.prisma`):
  - **Product domain (B안, 3 levels)**: `Style` (one detail page, URL `/products/[code]` = `styleCode`) → `StyleColor` (per-color images/status, `sortOrder` 0 = main color, `?color=BK` selects) → `Sku` (color × size; cart/order unit; `stock` is temporary until the inventory step). Masters: `Season`, `Category` (tree: `parentId` + `path` `/1/4/`, gender-neutral; gender is `Style.gender`), `Color` (`code`, `hex`, `family`), `SizeGroup`/`Size` (`sortOrder`). Masters also: `Material` (StyleMaterial.materialId — never free text), `Manufacturer`, `CareSymbol`. Details: `StyleColorImage`, `StyleMaterial`, `SizeMeasurement`, `ModelWear`, `StyleNotice` (JSON `[{label,value}]`), `StyleCare` (N:M), `StyleWearSeason` (N:M to enum), `StyleDetailBlock` (TEXT/IMAGE/VIDEO blocks by sortOrder). `Style.maxQtyPerOrder` is a per-order limit summed across all SKUs of the style — enforced by `findQtyLimitViolation()` in `lib/cart-rules.ts` (client-safe, shared by CartView and `createOrder`); `preorderShipDate`, `metaTitle`/`metaDescription` (used in `generateMetadata`).
  - **Price domain (C안)**: no price columns on `Style`. List price = `StylePrice` row with `validFrom <= now < validTo` (null = current; SCD Type 2, future rows allowed). Sale price is **computed, never stored**, by `getPrices(styleIds, now?)` in `lib/pricing.ts`: active `PricePromotion` (`status APPROVED` + `startAt <= now < endAt`) whose `PricePromotionTarget`s match (ALL/CATEGORY via `category.path` incl. descendants/SEASON/GENDER/STYLE; any EXCLUDE wins; most specific INCLUDE's `discountValueOverride`), RATE/AMOUNT/FIXED_PRICE → `roundingUnit`/`roundingMode` → `maxDiscountAmount`; the single largest discount wins (tie → `priority`). Do money math in integers (`list * (100 - n) / 100`, not `list * 0.7`). Styles without a current `StylePrice` are unsellable (excluded from list, 404, `CartSku.sellable=false`). `getCartSkus()` fills `listPrice/price/discountAmount/promotionId/promotionName`; `createOrder` snapshots them into `OrderItem`.
  - Pricing never sells at ≤ 0원: a promotion whose result would be < 1원 is treated as not applicable. Money math is integer-only.
  - Dates: seed parses date-only strings as KST via `kst()` (`new Date("2026-09-01")` is UTC = 09:00 KST). Display dates only through `formatDate`/`formatDateTime` in `lib/format.ts` (fixed `Asia/Seoul`; server TZ on Vercel is UTC).
  - Checkout aborts if the server-computed amount differs from the amount shown (a promotion started/ended in between) and releases that order's reservation via `cancelPendingOrder`.
  - Seed promotions are created relative to seed time (running / scheduled / ended / DRAFT / PAUSED) so behavior is visible whenever you seed; to re-seed pricing, delete `PricePromotion` rows first.
  - "Sold out" is never a status; it is derived from SKU stock. Sellable = `sellableStyleWhere()` / `sellableColorWhere` / `isStyleSellable()` in `lib/catalog.ts` (status ON_SALE + isDisplayed + not soft-deleted + sale window). Display labels for enums live in `lib/product-labels.ts` (client-safe).
  - Images are placeholder SVGs from `/api/placeholder?bg=&icon=&text=` stored as `StyleColorImage.url`; swap for real URLs later. `<img>` is used with an eslint-disable for `@next/next/no-img-element`.
  - `Order` (`status`: `PENDING` → `PAID`) has many `OrderItem`.
  - `OrderItem` references `skuId` (and optional `promotionId`, SetNull) and snapshots `listPrice`, `discountAmount`, `price`, `promotionName`, `styleCode`, `skuCode`, `styleName`, `colorName`, `sizeName`, `imageUrl` at order time; order pages read these snapshots, not the live product. Order totals are always calculated on the server from DB prices, never from amounts the client sends.
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
