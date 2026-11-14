-- Development schema extension for item-level discounts.
ALTER TABLE order_items ADD COLUMN original_price_cents INTEGER;
ALTER TABLE order_items ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0 CHECK(discount_percent IN (0,20,50));
ALTER TABLE order_items ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
