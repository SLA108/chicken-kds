-- Apply once to the target D1 database before deploying the Quick Order API.
-- Quick Orders remain ordinary orders; metadata is separated to preserve existing sales and payments.
CREATE TABLE IF NOT EXISTS order_platform_metadata (
  order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('wolt','uber_eats','pyszne','glovo','bolt_food','other')),
  external_order_id TEXT NOT NULL,
  platform_deadline_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(store_id, platform, external_order_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_deadline_store ON order_platform_metadata(store_id, platform_deadline_at);
