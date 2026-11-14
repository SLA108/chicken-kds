# Chicken i Kimchi POS + Kitchen KDS

Cloudflare Workers, D1, Durable Objects (store-isolated WebSocket rooms) and static assets. Development application; not yet live in restaurants.

## Application

- `/pos` — Front of House POS; requires a paired, authorized device.
- `/kitchen` — Kitchen Display; requires a paired, authorized device.
- `/admin` — Back Office; administrator PIN and secondary password for device pairing and grant changes.
- Device pairing is initiated on the POS/Kitchen device and approved in Back Office. Devices use renewable sessions; POS/Kitchen PIN login and manual device enrollment have been retired.
- Each device is bound to authorized stores; orders and live WebSocket events are isolated by store.
- Delivery-platform scanner integration is not implemented. Delivery orders can be entered manually in POS.

## Development and checks

```bash
npm install
npm run check:syntax
npm test
npm run dev
```

The single `V3 code checks` GitHub Actions workflow runs syntax, JavaScript and migration tests. Production deployment uses the separate `Deploy Chicken KDS to Cloudflare` workflow on `main` or manual dispatch.

## Configuration

`wrangler.toml` defines D1, Durable Object, static asset and R2 bindings. Configure `AUTH_SECRET`, `ADMIN_PIN`, and the secondary approval password `DEVICE_APPROVAL_PIN` in the Cloudflare Worker environment. Do not set obsolete `POS_PIN`, `KITCHEN_PIN`, or `SCANNER_PIN` for this version.

Database migrations under `migrations/` are retained as schema history; do not apply the base schema repeatedly to an existing database without checking its current state.

## Deployment

```bash
npm run deploy
```

Test pairing, POS order submission, Kitchen live updates, and store isolation against the deployed Worker and D1 database before using the system operationally.
