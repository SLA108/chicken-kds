-- Kitchen V2.2: explicit dispatch confirmation, independent of payment and dish ticks.
ALTER TABLE orders ADD COLUMN kitchen_completed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_kitchen_completed ON orders(kitchen_completed_at,created_at);
