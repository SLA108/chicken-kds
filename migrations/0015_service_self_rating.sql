-- Employee self-assessment captured atomically during manual POS checkout.
CREATE TABLE IF NOT EXISTS order_service_ratings (
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 store_id TEXT NOT NULL,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 rated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_ratings_store_date ON order_service_ratings(store_id,rated_at);
