-- Store/platform-specific display name and price for delivery Quick Orders.
-- Canonical menu ID and kitchen name remain unchanged.
CREATE TABLE IF NOT EXISTS platform_menu_overrides (
 store_id TEXT NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN ('wolt','uber_eats','pyszne','glovo','bolt_food','other')),
 menu_id TEXT NOT NULL,
 platform_name TEXT,
 price_cents INTEGER CHECK(price_cents IS NULL OR (price_cents>=0 AND price_cents<=10000000)),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(store_id,platform,menu_id),
 FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
 FOREIGN KEY(menu_id) REFERENCES menu(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_platform_menu_lookup ON platform_menu_overrides(store_id,platform);
