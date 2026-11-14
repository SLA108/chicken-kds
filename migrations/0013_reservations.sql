-- Reservations are independent of orders and never occupy tables.
CREATE TABLE IF NOT EXISTS reservations (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id),
 starts_at TEXT NOT NULL,
 party_size INTEGER NOT NULL CHECK(party_size BETWEEN 1 AND 50),
 guest_name TEXT NOT NULL DEFAULT '',
 phone TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','arrived','cancelled','no_show')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reservations_store_start ON reservations(store_id,starts_at);
