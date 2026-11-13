-- V2.4: persistent pickup acknowledgements per order item
ALTER TABLE order_items ADD COLUMN picked_up_at TEXT;
CREATE INDEX IF NOT EXISTS idx_order_items_pickup ON order_items(is_done,picked_up_at,done_at);
