-- Phase 2.1: persistent menu categories. Run once after backing up D1.
CREATE TABLE IF NOT EXISTS menu_categories (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE,
 sort_order INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO menu_categories(id,name,sort_order,active)
SELECT lower(hex(randomblob(16))),category,MIN(sort_order),1 FROM menu
WHERE trim(category)<>'' GROUP BY category;
CREATE INDEX IF NOT EXISTS idx_menu_categories_sort ON menu_categories(sort_order,name);
