# Front of House V2.1 – development checklist

Branch: `feature/foh-v2.1-tables-checkout`. **Do not deploy to production until tested.**

## Scope
- 20 fixed dine-in tables (01–20), open/occupied tiles
- Open Tickets primary navigation and checkout dialog
- Cash / Card / Other manual confirmation; payment recorded in existing `payments` table
- `paid_at` separate from kitchen preparation status
- D1 `table_occupancy` unique table constraint for simultaneous POS sessions
- Localized cart updates without recreating the menu on each add/remove

## Database migration
`migrations/0004_foh_tables_checkout.sql` must be applied **before** deploying this code.
Back up D1 first. Existing unpaid dine-in orders are checked by the API but are not automatically inserted into `table_occupancy`; legacy duplicates must be reviewed manually.

Suggested local validation:
```sh
git fetch origin
git switch feature/foh-v2.1-tables-checkout
node --check src/index.js
node --check public/app.js
NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection" ./node_modules/.bin/wrangler deploy --dry-run
```

## Acceptance tests (staging database only)
1. Table 01 available -> create ticket -> table 01 occupied.
2. Tap occupied 01 -> add items to existing ticket, no new ticket.
3. Open same table on two POS devices -> only one creation succeeds.
4. Complete every item in Kitchen -> table remains occupied.
5. Checkout Cash/Card/Other -> payment saved, paid_at set, table becomes available.
6. Attempt second checkout -> 409 and no duplicate payment.
7. Try adding items to paid ticket -> 409.
8. Tap Opakowanie repeatedly -> cart updates without menu image reload or scroll reset.
9. Test takeaway and delivery order creation and existing KDS WebSocket updates.
10. Verify existing legacy unpaid orders and duplicate table numbers before migrating.

**Caution:** No production checkout terminal integration; cashier confirms payment manually. Do not treat kitchen `done` as paid.
