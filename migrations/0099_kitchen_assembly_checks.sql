CREATE TABLE IF NOT EXISTS kitchen_assembly_checks (
 store_id TEXT NOT NULL,
 order_item_id TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 checked_by TEXT,
 PRIMARY KEY(store_id,order_item_id),
 FOREIGN KEY(order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kitchen_assembly_checks_store ON kitchen_assembly_checks(store_id);
