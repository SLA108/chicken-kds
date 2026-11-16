CREATE TABLE IF NOT EXISTS production_timing (
 store_id TEXT PRIMARY KEY REFERENCES stores(id),
 dine_in_minutes INTEGER NOT NULL DEFAULT 20 CHECK(dine_in_minutes BETWEEN 1 AND 240)
);
