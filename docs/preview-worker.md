# Preview Worker (shared production D1)

This repository defines a **separate** Cloudflare Worker named `chicken-kds-preview` in `wrangler.toml` under `[env.preview]`. It uses the **same** D1 database (`chicken_kds`) and R2 bucket as production, but has a separate Worker deployment and Durable Object namespace. This is a code preview, **not** a database sandbox. Use only the authorized **Test Store** and test devices.

## One-time setup

1. Configure required runtime secrets for the **preview** Worker (secrets do not automatically inherit from the default Worker):
   ```bash
   npx wrangler secret put AUTH_SECRET --env preview
   npx wrangler secret put ADMIN_PIN --env preview
   npx wrangler secret put DEVICE_APPROVAL_PIN --env preview
   ```
   If the application uses any other production secrets, configure their preview equivalents too. Do not commit secret values.
2. Deploy manually from this branch:
   ```bash
   npm install
   npm run check:syntax && npm test
   npm run deploy:preview
   ```
   Alternatively, use **Actions → Deploy Chicken KDS Preview → Run workflow** after configuring GitHub `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The workflow is manual-only and never deploys production.
3. Open `https://chicken-kds-preview.bilibala.workers.dev/pos` or `/kitchen` and pair the test devices through the preview application. Restrict authorization to **Test Store**. Do not reuse production tablets for preview unless intentional.

## Notes

- `npm run deploy` still deploys **production**. Use `npm run deploy:preview` for testing.
- This environment does **not** create or migrate a D1 database. Do not run `npm run db:remote` for preview.
- The Cloudflare dashboard's wildcard `*-chicken-kds.bilibala.workers.dev` refers to preview versions of the **production-named** Worker, not this independently named `chicken-kds-preview` Worker. Use the URL printed by Wrangler after the first preview deployment.
- Changes to shared D1 are real and visible to production. Even in Test Store, avoid destructive test data and verify store-scoped authorization.
- Preview has its own Durable Object instance namespace; live websocket notifications may not propagate between preview and production. Refresh when cross-environment updates matter.
