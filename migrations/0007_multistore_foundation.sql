-- V3.0 phase 1: additive multi-store schema foundation.
-- PRECONDITION: schema.sql and migrations 0002 through 0006 have already been applied.
-- BACK UP D1 BEFORE RUNNING. Run this migration ONCE.
-- This migration does NOT enable multi-store operation: API, WebSocket, table
-- occupancy and role authorization remain single-store until phase 2.
-- Existing historical orders belong to Test Store, confirmed by operator.
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO stores(id,code,name,active,created_at)
VALUES ('legacy-primary','TEST','Test Store',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- These are planned stores only; they are inactive until store-aware API isolation is complete.
INSERT OR IGNORE INTO stores(id,code,name,active,created_at) VALUES
 ('store-slow','SLOW','Słowackiego',0,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('store-srod','SROD','Śródmieście',0,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('store-gdy','GDY','Gdynia',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

ALTER TABLE orders ADD COLUMN store_id TEXT NOT NULL DEFAULT 'legacy-primary' REFERENCES stores(id);
ALTER TABLE payments ADD COLUMN store_id TEXT NOT NULL DEFAULT 'legacy-primary' REFERENCES stores(id);
-- Menu is still a shared catalog. Per-store price/availability overrides follow later.
CREATE TABLE IF NOT EXISTS store_menu_overrides (
  store_id TEXT NOT NULL REFERENCES stores(id),
  menu_id TEXT NOT NULL REFERENCES menu(id),
  price_cents INTEGER CHECK(price_cents IS NULL OR price_cents >= 0),
  active INTEGER CHECK(active IS NULL OR active IN (0,1)),
  sold_out INTEGER NOT NULL DEFAULT 0 CHECK(sold_out IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (store_id,menu_id)
);
CREATE TABLE IF NOT EXISTS pos_devices (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_store_created ON orders(store_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_store_status ON orders(store_id,status,paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_store_created ON payments(store_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_devices_store ON pos_devices(store_id,active);
