# V3.0 Multi-store rollout plan (phase 1)

Status: **schema migration committed, not applied, not deployed**. Do not register a second store or operate two restaurants on the current Worker.

## Current single-store constraints verified
- `src/index.js`: `room(env)` always uses Durable Object name `main`; WebSocket broadcasts are global.
- `getOrders()` and POS/KDS endpoints do not filter by `store_id`.
- `table_occupancy` uses `table_no` as a global primary key; identical table numbers cannot coexist across stores.
- `/api/login` issues role-level credentials without a store or individual user scope.
- The frontend uses the same menu and order API across all devices.

## Phase 1 completed in code
`migrations/0007_multistore_foundation.sql` creates `stores`, `store_menu_overrides`, `pos_devices`; adds `store_id` to existing `orders` and `payments`; and adds store-aware indexes. All historical rows are assigned `legacy-primary` pending confirmation of the correct original location. Existing endpoints remain unchanged.

## Before applying migration
1. Historical orders are confirmed to be test-only. Verify that the target database contains only those test orders before migration.
2. Back up remote D1 and verify backup/restoration.
3. Verify schema and previously applied migrations; apply `0007` only once in staging first.
4. Confirm there are no externally managed consumers depending on old table shapes.
5. Test existing POS/KDS end-to-end in staging.

## Next required implementation (not yet done)
1. Replace role-only login with authenticated user/device context including `store_id`; bind devices in Back Office with administrative approval and revoke support.
2. Require server-derived store context on **all** order/table/payment/menu operations; never trust a client-supplied `store_id` without authorization.
3. Rebuild `table_occupancy` with composite `(store_id,table_no)` uniqueness; migrate existing occupancy safely.
4. Scope every query, mutation, idempotency key and history/report endpoint to authorized store(s), including kitchen pickups and table release.
5. Partition Durable Object rooms by store and authorize the WebSocket handshake; prevent cross-store broadcast.
6. Implement central menu with store-specific price, visibility and sold-out state; use server-side effective price during checkout.
7. Test same table numbers, concurrent tickets, checkout, history, reconnect, role permissions and menu overrides in two stores.
8. Only after successful staging validation: roll out to production with a rollback procedure.

## Safety
**Do not run `0007` on production yet.** Its additive schema is not sufficient for multi-store isolation. Never deploy a multi-store UI until server-side isolation is complete.
