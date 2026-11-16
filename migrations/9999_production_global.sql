-- Global production recipes and optional per-store overrides.
-- Existing store-specific production tables are preserved.
CREATE TABLE IF NOT EXISTS production_global_components (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 unit TEXT NOT NULL DEFAULT 'portion',
 prep_minutes INTEGER NOT NULL DEFAULT 0 CHECK(prep_minutes BETWEEN 0 AND 1440),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS production_global_mappings (
 id TEXT PRIMARY KEY,
 component_id TEXT NOT NULL REFERENCES production_global_components(id) ON DELETE CASCADE,
 menu_id TEXT NOT NULL REFERENCES menu(id),
 modifier_option_id TEXT,
 quantity_per_dish REAL NOT NULL DEFAULT 1 CHECK(quantity_per_dish > 0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_production_global_mappings_menu ON production_global_mappings(menu_id);
CREATE TABLE IF NOT EXISTS production_store_overrides (
 store_id TEXT NOT NULL REFERENCES stores(id),
 component_id TEXT NOT NULL REFERENCES production_global_components(id) ON DELETE CASCADE,
 prep_minutes INTEGER CHECK(prep_minutes BETWEEN 0 AND 1440),
 active INTEGER CHECK(active IN (0,1)),
 PRIMARY KEY(store_id,component_id)
);
