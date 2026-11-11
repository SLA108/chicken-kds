CREATE TABLE IF NOT EXISTS menu (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, source TEXT NOT NULL, table_no TEXT, status TEXT NOT NULL CHECK(status IN ('new','cooking','done','cancelled')), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL, client_key TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), menu_id TEXT, name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, event TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_order ON events(order_id, created_at);
CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, synced_at TEXT);
