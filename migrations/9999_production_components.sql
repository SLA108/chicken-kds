-- Configurable kitchen production components; additive migration, no changes to existing orders.
CREATE TABLE IF NOT EXISTS production_components (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id),
 name TEXT NOT NULL,
 unit TEXT NOT NULL DEFAULT 'portion',
 prep_minutes INTEGER NOT NULL DEFAULT 0 CHECK(prep_minutes >= 0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(store_id,id)
);
CREATE INDEX IF NOT EXISTS idx_production_components_store ON production_components(store_id,active,name);
CREATE TABLE IF NOT EXISTS production_component_mappings (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id),
 component_id TEXT NOT NULL,
 menu_id TEXT NOT NULL REFERENCES menu(id),
 modifier_option_id TEXT,
 quantity_per_dish REAL NOT NULL DEFAULT 1 CHECK(quantity_per_dish > 0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(store_id,component_id) REFERENCES production_components(store_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_production_mappings_store_menu ON production_component_mappings(store_id,menu_id);
CREATE INDEX IF NOT EXISTS idx_production_mappings_component ON production_component_mappings(component_id);
