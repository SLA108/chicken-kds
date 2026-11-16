-- Emoji configuration for global, store-local, and store-overridden production components.
ALTER TABLE production_global_components ADD COLUMN emoji TEXT NOT NULL DEFAULT '';
ALTER TABLE production_components ADD COLUMN emoji TEXT NOT NULL DEFAULT '';
ALTER TABLE production_store_overrides ADD COLUMN emoji TEXT;
