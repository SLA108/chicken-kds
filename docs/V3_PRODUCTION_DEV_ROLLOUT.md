# V3 production-as-development rollout

This project is still in development. The operator has chosen to test V3 in the Cloudflare **production environment**, without a separate staging deployment. This does **not** waive database safety or imply that V3 is ready.

## Non-negotiable pre-deploy gates
1. Confirm GitHub syntax checks and tests pass on the exact release commit. Existing tests mostly assert source strings, not end-to-end behavior.
2. Identify the actual Cloudflare Worker and D1 database bindings; ensure there is no ambiguity about the target. Never assume the Wrangler default points to the intended database.
3. Export a D1 backup and verify the export is readable **before** changing the schema. Document recovery steps and downtime expectations.
4. Inspect existing migrations 0002–0006 and the remote D1 migration history. Do not blindly replay schema.sql or migrations that have already been applied.
5. Run `migrations/v3_preflight_readonly.sql` on the target D1 before applying 0009. Resolve duplicate payments, mismatched stores and orphaned records; a unique index may otherwise fail.
6. Apply 0007, 0008, 0009, 0010 **once, in order**, after confirming prerequisites and compatibility with current data. Migration 0008 rebuilds table_occupancy and can fail if foreign keys or existing rows conflict.
7. Deploy Worker and static frontend from the **same commit**. Configure V3 secrets and device registration, and ensure the Worker uses the intended D1 binding.
8. Run the smoke test below with explicitly labeled TEST orders. Keep actual restaurant orders out until checks pass.

## Production smoke test
- [ ] Admin login and stores/device listing work.
- [ ] Enroll a POS and Kitchen device for store A; login and revoke work.
- [ ] Create another store's devices; verify cross-store order/table/payment access is rejected.
- [ ] Store A and B can independently occupy table 01.
- [ ] Store menu price, active and sold-out overrides are enforced at order creation.
- [ ] Create orders; Kitchen receives updates via WebSocket; dish completion updates POS pickup.
- [ ] Pickup acknowledgement works, including after kitchen completion and reopening.
- [ ] Checkout exactly once; duplicate checkout and concurrent item additions are rejected.
- [ ] Kitchen completion, reopen and item-toggle race checks behave correctly.
- [ ] Paid history and admin sales report show correct store/date data.
- [ ] No unexpected errors in Worker logs; backup is still available.

## Cutover and rollback
- Treat 0008 (table rebuild) and 0009 (constraints) as **schema changes that cannot be undone by rolling back Worker code alone**.
- If the deployment fails after a migration, do not redeploy old Worker code against the new schema without checking compatibility.
- Restore the backup only with an explicit decision about any data written since export.
- Keep `ENABLE_V3_STORE_ADMIN` disabled until admin writes are intentionally enabled. Review `DISABLE_LEGACY_STORE_ACCESS` before multi-store operation so legacy role tokens cannot bypass store isolation.

## Release record
- Branch: `feature/v3-multistore-foundation`
- Production deployment: **not performed**
- Production D1 migrations: **not performed**
- Automated tests: **not verified green**
- Smoke tests: **not performed**

This document supersedes staging-first instructions for this development-phase rollout; older migration comments remain conservative safety warnings.
