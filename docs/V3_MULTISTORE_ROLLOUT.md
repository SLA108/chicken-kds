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

## Phase 2 schema committed (not applied)\n\n`migrations/0008_multistore_tables.sql` replaces the global table-number primary key with `(store_id, table_no)` and copies existing occupancy rows using their owning order's store. Apply only after 0007, in staging first. Existing application SQL still assumes globally unique table numbers, so this migration must NOT be applied independently to production.\n\n## Phase 2 API groundwork committed (not deployed)\n\n`GET /api/admin/stores` is a read-only, admin-only endpoint listing configured stores and historical order counts. It returns `multistore_enabled: false` and a 503 error with `MULTISTORE_SCHEMA_MISSING` if migration 0007 has not been applied. This endpoint does not authorize POS/KDS store selection and does not isolate any existing order endpoints.\n\n## Device registration groundwork committed (not deployed)

Admin-only endpoints added to `src/index.js`:
- `GET /api/admin/devices`: list registered devices without their token hashes.
- `POST /api/admin/devices`: register a device against an **active** store; generates a cryptographically random 32-byte enrollment secret, stores only its SHA-256 hash, returns the secret once.
- `POST /api/admin/devices/:id/revoke`: mark a device revoked.

**Security limitation:** the current admin role is protected by a shared PIN and reusable token. These endpoints are **not production-ready** without stronger administrator authentication, enrollment approval, rate limiting, audit logs, and a short-lived device onboarding exchange. The enrollment secret is currently returned in JSON, not a secure HttpOnly cookie. The new device secrets do **not** grant POS/KDS access; existing shared-PIN auth remains unchanged. Do not enroll production devices or deploy this feature yet.

## Next required implementation (not yet done)
1. Replace role-only login with authenticated user/device context including `store_id`; bind devices in Back Office with administrative approval and revoke support.
2. Require server-derived store context on **all** order/table/payment/menu operations; never trust a client-supplied `store_id` without authorization.
3. Update all occupancy queries and writes to use the new composite `(store_id,table_no)` key; migration 0008 has been drafted, but application integration remains outstanding.
4. Scope every query, mutation, idempotency key and history/report endpoint to authorized store(s), including kitchen pickups and table release.
5. Partition Durable Object rooms by store and authorize the WebSocket handshake; prevent cross-store broadcast.
6. Implement central menu with store-specific price, visibility and sold-out state; use server-side effective price during checkout.
7. Test same table numbers, concurrent tickets, checkout, history, reconnect, role permissions and menu overrides in two stores.
8. Only after successful staging validation: roll out to production with a rollback procedure.

## Safety
**Do not run `0007` on production yet.** Its additive schema is not sufficient for multi-store isolation. Never deploy a multi-store UI until server-side isolation is complete.
