-- Open-price products keep their actual sale price on order_items.
-- Existing dishes retain their previous behavior.
ALTER TABLE menu ADD COLUMN open_price INTEGER NOT NULL DEFAULT 0 CHECK(open_price IN (0,1));
ALTER TABLE menu ADD COLUMN send_to_kitchen INTEGER NOT NULL DEFAULT 1 CHECK(send_to_kitchen IN (0,1));
