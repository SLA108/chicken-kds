-- FOH V2.1: payment lifecycle and exclusive table occupancy.
ALTER TABLE orders ADD COLUMN paid_at TEXT;
CREATE TABLE IF NOT EXISTS table_occupancy (
 table_no TEXT PRIMARY KEY,
 order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_unpaid_tables ON orders(source,table_no,paid_at,status);
-- Legacy orders may include duplicate unpaid table numbers. The application
-- checks those orders before allocating a table; do not silently claim one.
