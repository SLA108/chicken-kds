# V3 persistent device login — deployment checklist

Status: **code committed; not yet validated in a deployed environment**.

## Behavior
- Admin enrolls one device under an active store and records the one-time secret.
- First device sign-in requires the role PIN, device ID and enrollment secret.
- First sign-in binds the device to its role (POS/Kitchen/Scanner); subsequent role changes require revoking and enrolling a new device.
- The server sets a Secure, HttpOnly, SameSite=Strict cookie scoped to `/api/device/renew`.
- Browser renews an eight-hour store session automatically every hour and on reopening the app.
- Renew verifies the stored device secret against D1 and checks that device and store are active.
- Explicit Log out clears the persistent device cookie. Device revocation blocks new sessions and all store-scoped requests.
- Browser data clearing, device changes, and loss of the cookie require re-enrollment.
- Cookie lifetime is renewed on use, with a one-year browser cookie maximum between uses. This is not an irrevocable permanent login.

## Before production deployment
1. Back up remote D1; verify the backup.
2. Pull the feature branch and run `npm run check:syntax && npm test`.
3. Apply `migrations/0011_device_role_binding.sql` **once** to remote D1 only after checking the schema; previous 0007–0010 files were already applied manually.
4. Deploy Worker using `npx wrangler deploy`.
5. In Test Store, sign in with registered POS device and confirm login; close/reopen browser and verify automatic restore.
6. Check that the same device cannot sign in as Kitchen; use a separate Kitchen device.
7. Revoke a test device in Admin and verify that renewal and all store APIs reject it.
8. Test browser logout, network reconnect and POS-to-Kitchen WebSocket messages.
9. Do **not** enable `DISABLE_LEGACY_STORE_ACCESS` until all active devices are migrated and tested.

## Known limitations
- Current implementation uses one persistent device cookie per browser origin. Separate POS and Kitchen physical devices are recommended.
- A browser that blocks cookies or clears site data requires another enrollment.
- Production and remote D1 have **not** been modified by these GitHub commits.
