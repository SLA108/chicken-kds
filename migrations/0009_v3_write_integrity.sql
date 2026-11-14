-- V3 write-integrity guards. Apply only after 0007 and 0008 in isolated staging.
-- Verify historical payment duplicates before enabling unique index.
-- A paid order must have at most one checkout payment in this version.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_per_order_v3 ON payments(order_id);

-- Prevent adding items to a paid, cancelled, or kitchen-completed order.
-- This database-level guard closes the gap between preflight checks and batch writes.
CREATE TRIGGER IF NOT EXISTS trg_order_items_v3_open_insert
BEFORE INSERT ON order_items
WHEN NOT EXISTS (
 SELECT 1 FROM orders
 WHERE id=NEW.order_id
 AND paid_at IS NULL
 AND kitchen_completed_at IS NULL
 AND status!='cancelled'
)
BEGIN
 SELECT RAISE(ABORT,'Order closed for item additions');
END;

-- Prevent a payment belonging to another store or a different order.
CREATE TRIGGER IF NOT EXISTS trg_payments_v3_store_insert
BEFORE INSERT ON payments
WHEN NOT EXISTS (
 SELECT 1 FROM orders WHERE id=NEW.order_id AND store_id=NEW.store_id
)
BEGIN
 SELECT RAISE(ABORT,'Payment store mismatch');
END;

-- Preserve the same store-to-order invariant when updating a payment.
CREATE TRIGGER IF NOT EXISTS trg_payments_v3_store_update
BEFORE UPDATE OF order_id,store_id ON payments
WHEN NOT EXISTS (
 SELECT 1 FROM orders WHERE id=NEW.order_id AND store_id=NEW.store_id
)
BEGIN
 SELECT RAISE(ABORT,'Payment store mismatch');
END;
