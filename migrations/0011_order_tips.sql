-- Run once against the existing D1 database before deploying the Tips API.
CREATE TABLE IF NOT EXISTS order_tips (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id),
 store_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 method TEXT NOT NULL CHECK(method IN ('cash','card')),
 stage TEXT NOT NULL CHECK(stage IN ('checkout','release')),
 created_at TEXT NOT NULL,
 actor TEXT NOT NULL,
 request_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_order_tips_store_date ON order_tips(store_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_tips_order ON order_tips(order_id);
