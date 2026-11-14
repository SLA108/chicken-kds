# V3 staging deployment gate (2026-11-14)

This checklist is for an **isolated staging deployment**, not production. Do not run migrations against the live D1 database.

## Gate A — automated checks (must pass)
- [ ] GitHub Actions `V3 code checks` is green for the exact commit deployed.
- [ ] `npm run check:syntax` passes.
- [ ] `npm test` passes. Existing routing tests inspect source strings; they are **not** integration tests.
- [ ] Worker starts with the staging configuration and static POS/Kitchen/Admin routes load.

## Gate B — staging database and configuration
- [ ] Use a distinct staging D1 database, separate from production, with a backup.
- [ ] Apply schema and migrations 0002–0010 in order as applicable to the staging database; check each existing migration for idempotency and prerequisites.
- [ ] Run `migrations/v3_preflight_readonly.sql` before migration 0009 (after 0007/0008), and investigate any nonempty result.
- [ ] Confirm D1 migration 0009 uniqueness and triggers, and migration 0010 dish-update trigger, using real staging writes.
- [ ] Set staging-only AUTH_SECRET, POS_PIN, KITCHEN_PIN and other required secrets. Do not reuse production secrets.
- [ ] Keep `ENABLE_V3_STORE_ADMIN` disabled until admin write operations have been verified; never enable legacy-role blocking on production as part of staging setup.

## Gate C — functional tests in staging
- [ ] Admin registers a device; one-time enrollment secret works and revoked device loses access.
- [ ] Słowackiego and Śródmieście can use the same table number without collisions.
- [ ] Device A cannot list, read, modify, pick up, or pay Device B's orders.
- [ ] Store-specific menu prices, active overrides and sold-out flags affect both display and order totals.
- [ ] POS creates dine-in, takeaway and delivery orders; retrying client_key is idempotent.
- [ ] Kitchen receives each order via WebSocket and marks dishes done; POS receives pickup updates.
- [ ] POS acknowledges pickup, performs checkout exactly once, and sees paid-order history.
- [ ] Concurrent checkout/add-items and kitchen complete/item-done operations produce safe outcomes.
- [ ] Kitchen reopen preserves dish state and pickup history.
- [ ] Admin store-sales uses Warsaw dates including DST transitions; TEST store excluded by default.

## Gate D — production promotion (later)
- [ ] Repeat the tests above against a production-like staging snapshot.
- [ ] Confirm rollback and backup/restore procedures.
- [ ] Record actual test evidence and sign off before merging/deploying to production.

**Current status:** no passing CI, staging D1 migration, or end-to-end test result has been verified in this checklist.
