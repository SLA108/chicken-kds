# Kitchen DAG + Quick Order rollout

## Current scope
- POS and Kitchen can create store-scoped delivery Quick Orders via `POST /api/store/quick-orders`.
- Quick Orders use the existing `orders`, `order_items`, `events` and `sync_outbox` tables, with platform metadata stored separately.
- Kitchen Tickets show platform, external order number and original Ready By.
- `GET /api/store/kitchen/dag` provides store-scoped dish aggregation.
- No automatic payments are inserted for Quick Orders. Revenue recognition remains controlled by the existing checkout/payment workflow.
- Platform-specific item name/price overrides, DAG timeline UI, platform API imports and automatic payment reconciliation are **not implemented**.

## Deployment prerequisite — migration first
**Do not deploy this branch before the migration is applied.** The order listing now reads `order_platform_metadata` and will fail if the table is absent.

From the project root, after backing up the target database:

```bash
npx wrangler d1 execute chicken_kds --remote --file=migrations/quick_order_platform.sql
```

Run only against the intended environment, and verify schema before deploying the Worker. Do not run this against production merely to test the feature.

## Local development
```bash
git fetch origin
git switch feature/kitchen-dag-quick-order
git pull --ff-only origin feature/kitchen-dag-quick-order
npm install --no-package-lock
npm run check:syntax
npm test
```

## Important constraints
- Platform order IDs are unique per store and platform.
- The original platform Ready By is never silently replaced by kitchen scheduling.
- Existing POS/Kitchen sessions remain store scoped; kitchen role may only create Quick Orders, not ordinary POS orders.
- Menu pricing currently follows the existing store-specific menu override logic; platform-specific overrides are future work.
- Dishes with mandatory modifiers must use the existing POS flow until Quick Order modifier selection is implemented.
- Keep the PR as Draft until database migration, end-to-end testing and release checks are complete.
