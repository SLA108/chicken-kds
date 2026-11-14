# V3 Back Office device pairing (not deployed)

## User flow
1. Open /pos or /kitchen on the restaurant tablet and select **Pair this device via Back Office**.
2. A random six-digit code is displayed for 10 minutes. The browser keeps a separate random HttpOnly pairing secret.
3. An administrator opens Back Office → Stores (V3), chooses an **active** store, enters the code, device name, role, and secondary approval password.
4. The tablet polls for approval and automatically receives its role-bound store session and an HttpOnly renewal cookie.
5. The employee never sees or handles the underlying device credential.

## Deployment prerequisites
- **Do not deploy before testing**. This branch is still under development.
- Back up remote D1 and apply the revised **0011** migration exactly once; it adds `pos_devices.role` and `device_pair_requests`. The original 0011 had not been applied at the time this work started.
- Configure `DEVICE_APPROVAL_PIN` as a Worker **secret** of at least 8 characters. Never put it in `wrangler.toml`, GitHub, or a browser.
- Run `npm run check:syntax && npm test`; manually test pairing, expiry, role mismatch, logout, revoked device, inactive store, browser restart, and WebSocket store isolation.
- Keep legacy access enabled until POS/Kitchen device mode is verified.
- A browser cleared of site data requires re-pairing. The one-year renewal cookie is extended on use; it is not a guarantee of permanent access.
- One device/browser origin should be dedicated to one role; POS and Kitchen should normally use separate tablets.

## Pending hardening
- Add integration tests for pairing endpoint transactions, cookie behavior, and simultaneous approvals.
- Add explicit per-IP/device throttling and request quotas to prevent pairing request flooding.
- Confirm secondary-password verification and renewal behavior on staging before production rollout.
