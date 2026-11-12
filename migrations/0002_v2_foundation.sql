-- Apply once to an existing V1 D1 database. Backup first.
ALTER TABLE menu ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE menu ADD COLUMN vat_rate INTEGER NOT NULL DEFAULT 8;
ALTER TABLE order_items ADD COLUMN is_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN done_at TEXT;
ALTER TABLE order_items ADD COLUMN price_cents INTEGER;
ALTER TABLE order_items ADD COLUMN vat_rate INTEGER;
CREATE TABLE IF NOT EXISTS modifier_groups (id TEXT PRIMARY KEY,name TEXT NOT NULL,required INTEGER NOT NULL DEFAULT 0,min_select INTEGER NOT NULL DEFAULT 0,max_select INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS modifier_options (id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES modifier_groups(id),name TEXT NOT NULL,price_cents INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS menu_modifier_groups (menu_id TEXT NOT NULL REFERENCES menu(id),group_id TEXT NOT NULL REFERENCES modifier_groups(id),PRIMARY KEY(menu_id,group_id));
CREATE TABLE IF NOT EXISTS order_item_modifiers (id TEXT PRIMARY KEY,order_item_id TEXT NOT NULL REFERENCES order_items(id),option_id TEXT,name TEXT NOT NULL,price_cents INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),method TEXT NOT NULL,amount_cents INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_order_items_order_done ON order_items(order_id,is_done);
