# Chicken i Kimchi POS + KDS V1.0

Cloudflare Worker + Durable Object (WebSocket) + D1 + static assets. No paid AI services required.

## What works
- `/pos`: create dine-in / takeaway / manually entered delivery orders, select table, add items, add items to an open order.
- `/kitchen`: receive real-time events, audible notification after explicit audio activation, start cooking, complete order.
- `/admin`: live order monitoring, history (last 120 orders), add menu items.
- `/scanner`: placeholder only. **No camera, OCR, AI or upload is implemented.**
- D1 stores orders, items, menu, events and a synchronization outbox. Google Sheets export is **not implemented yet**.

## Setup (macOS or Linux)
1. Install Node.js 20+ and log in: `npm install`, `npx wrangler login`.
2. Create a D1 database: `npx wrangler d1 create chicken_kds`.
3. Copy its `database_id` into `wrangler.toml` replacing `REPLACE_WITH_D1_DATABASE_ID`.
4. Initialize remote tables: `npm run db:remote`.
5. Set secrets one at a time:
   ```bash
   npx wrangler secret put AUTH_SECRET
   npx wrangler secret put POS_PIN
   npx wrangler secret put KITCHEN_PIN
   npx wrangler secret put ADMIN_PIN
   npx wrangler secret put SCANNER_PIN
   ```
   Use a random long `AUTH_SECRET` (32+ characters) and **distinct strong PIN/passphrases**. This is a prototype login mechanism, not enterprise identity management.
6. Deploy: `npm run deploy`. Wrangler prints your public workers.dev URL.
7. Open `/admin` and add your actual menu. Then log in to `/pos` and `/kitchen` on separate iPads.
8. On kitchen iPad, tap **Enable sound** once; keep the browser foregrounded and screen awake.

### Local development
Use `npm run db:local` to initialize the local database. Put local secrets in `.dev.vars` (never commit it), with `AUTH_SECRET`, `POS_PIN`, `KITCHEN_PIN`, `ADMIN_PIN`, `SCANNER_PIN`, then `npm run dev`.

## Important limitations before production use
- The prototype uses a shared role PIN and bearer token; **add login rate limiting / Cloudflare WAF, individual employee accounts, audit controls and token expiry** before exposing publicly for real business use. Prefer Cloudflare Access or a robust authentication provider.
- This is **not a fiscal cash register**; no payment, refunds, receipt printing or Poland fiscalization.
- WebSocket is best-effort; browser reconnection and 60-second periodic reconciliation are included. Kitchen sound cannot be guaranteed while iPad is locked, Safari is suspended, or the browser is offline.
- Do not rely on this as the sole order channel until load, offline, permission and operational tests are completed.
- Adding items to an existing order is supported, but per-item cooking status, voiding individual items, staff presence, shift reports and automatic Sheets sync are not yet implemented.
- Menu management currently adds items; editing, deleting, and bulk importing menu items will be added in a later release.
- Scanner is a placeholder; do not expect platform orders to appear automatically.
- D1 is the source of truth. The `sync_outbox` table is reserved for a future Apps Script / Google Sheets synchronization job.
- Confirm platform terms and privacy requirements before integrating delivery-platform orders or uploading screenshots.

## Manual test
1. In admin, add e.g. `Bibimbap` under `主食` at `35.00`.
2. Open POS and kitchen in two devices. Enable sound in kitchen.
3. Place a dine-in order and check KDS arrival, then click `开始制作` and `完成出餐`.
4. Verify changes on `/admin` and `/pos` and test reconnection by toggling Wi-Fi.
5. Double-submit protection uses a client-generated idempotency key. Check database order count.

## Architecture
`/api/orders` is authenticated and writes to D1, then broadcasts a WebSocket event via Durable Object. All clients refetch canonical state on event. Worker static assets serve the same SPA on all four routes. The system uses `Europe/Warsaw` for displayed kitchen times; D1 timestamps are UTC ISO 8601.
