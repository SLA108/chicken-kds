-- V3 kitchen concurrency protection. Apply after 0009, in staging first.
-- A kitchen-completed or cancelled order must not have dish completion
-- toggled by a stale concurrent request.
CREATE TRIGGER IF NOT EXISTS trg_order_items_v3_open_update
BEFORE UPDATE OF is_done,done_at,picked_up_at ON order_items
WHEN NOT EXISTS (
 SELECT 1 FROM orders
 WHERE id=NEW.order_id
   AND kitchen_completed_at IS NULL
   AND status!='cancelled'
)
BEGIN
 SELECT RAISE(ABORT,'Order closed for dish updates');
END;
