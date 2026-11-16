-- Platform orders are handed to couriers, not paid at the POS or served through the FOH pickup queue.
ALTER TABLE order_platform_metadata ADD COLUMN collected_at TEXT;
ALTER TABLE order_platform_metadata ADD COLUMN collected_by TEXT;
CREATE INDEX IF NOT EXISTS idx_platform_courier_store ON order_platform_metadata(store_id,collected_at);
