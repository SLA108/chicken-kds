-- V3.0 phase 2: allow the same table number in different stores.
-- Prerequisite: apply 0007 first. BACK UP D1. Run ONCE in staging before production.
-- This changes schema only; existing API is NOT multi-store safe yet.
CREATE TABLE table_occupancy_v3 (
  store_id TEXT NOT NULL REFERENCES stores(id),
  table_no TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (store_id, table_no)
);
INSERT INTO table_occupancy_v3(store_id,table_no,order_id,created_at)
SELECT o.store_id,t.table_no,t.order_id,t.created_at
FROM table_occupancy t
JOIN orders o ON o.id=t.order_id;
DROP TABLE table_occupancy;
ALTER TABLE table_occupancy_v3 RENAME TO table_occupancy;
CREATE INDEX idx_table_occupancy_order ON table_occupancy(order_id);
