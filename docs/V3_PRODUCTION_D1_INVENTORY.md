# Production D1 read-only inventory (V3)

**Target verified from `wrangler.toml` in repository (not from Cloudflare account):**
- Worker: `chicken-kds`
- D1 binding: `DB`
- D1 name: `chicken_kds`
- D1 ID: `82bc303c-98c0-4701-9a5d-bbf703a2bb6d`

**No remote D1 access or backup has been executed by this document.** Before any writes, run the following commands from the V3 branch on a machine authenticated to the correct Cloudflare account. Inspect results and stop if the target differs.

```sh
npx wrangler whoami
npx wrangler d1 list
npx wrangler d1 execute chicken_kds --remote --command "SELECT name,type FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type,name;"
npx wrangler d1 execute chicken_kds --remote --command "PRAGMA table_info(orders);"
npx wrangler d1 execute chicken_kds --remote --command "PRAGMA table_info(payments);"
npx wrangler d1 execute chicken_kds --remote --command "PRAGMA table_info(table_occupancy);"
npx wrangler d1 execute chicken_kds --remote --command "SELECT COUNT(*) AS orders_count FROM orders;"
npx wrangler d1 execute chicken_kds --remote --command "SELECT COUNT(*) AS payments_count FROM payments;"
npx wrangler d1 execute chicken_kds --remote --command "SELECT COUNT(*) AS occupied_tables FROM table_occupancy;"
```

Only if the `stores` table already exists, inspect current V3 rollout state:

```sh
npx wrangler d1 execute chicken_kds --remote --command "SELECT id,code,name,active FROM stores ORDER BY code;"
npx wrangler d1 execute chicken_kds --remote --command "SELECT store_id,COUNT(*) AS n FROM orders GROUP BY store_id;"
npx wrangler d1 execute chicken_kds --remote --file=./migrations/v3_preflight_readonly.sql
```

**Stop conditions:** unexpected Cloudflare account or database ID; missing required legacy columns; partial V3 migration; duplicate payments; missing order references; non-test historical data whose ownership is uncertain.

After inspection and **before migration**, take and verify an export:

```sh
mkdir -p backups
npx wrangler d1 export chicken_kds --remote --output=backups/chicken_kds_before_v3.sql
test -s backups/chicken_kds_before_v3.sql
```

Keep the SQL backup out of Git. Export success and file size alone do not prove restore success; validate in a separate database if feasible. Do not run `schema.sql` on an existing production D1. Do not apply 0007–0010 until the actual remote schema has been reviewed.

The successful GitHub Actions checks on commit `cbb3dfd` verify syntax, Node tests, and SQLite fixture tests only; they do **not** validate the remote Cloudflare D1.
