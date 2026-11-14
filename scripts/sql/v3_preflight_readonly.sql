-- Read-only preflight for V3 migration 0009. Optional diagnostic queries; not a database migration.
-- Every query should return zero rows; any rows require manual review.
-- 1. Duplicate payments for the same order (0009 creates a unique index).
SELECT order_id,COUNT(*) AS payment_count
FROM payments
GROUP BY order_id HAVING COUNT(*)>1;

-- 2. Payments whose store differs from their order.
SELECT p.id AS payment_id,p.order_id,p.store_id AS payment_store,o.store_id AS order_store
FROM payments p LEFT JOIN orders o ON o.id=p.order_id
WHERE o.id IS NULL OR p.store_id!=o.store_id;

-- 3. Orders whose store is missing.
SELECT o.id,o.store_id FROM orders o
LEFT JOIN stores s ON s.id=o.store_id WHERE s.id IS NULL;

-- 4. Orphaned order items.
SELECT i.id,i.order_id FROM order_items i
LEFT JOIN orders o ON o.id=i.order_id WHERE o.id IS NULL;

-- 5. Conflicting occupied tables in the same store (required for migration 0008).
-- Only run this query BEFORE migration 0008, on the old table_occupancy.
-- SELECT o.store_id,t.table_no,COUNT(*) AS occupied_count
-- FROM table_occupancy t JOIN orders o ON o.id=t.order_id
-- GROUP BY o.store_id,t.table_no HAVING COUNT(*)>1;
