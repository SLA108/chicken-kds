-- V3.1 device-to-store allowlist. Apply only after 0011, following backup.
-- Backfill existing active and revoked devices with their original store,
-- preserving current access until an administrator changes the allowlist.
CREATE TABLE IF NOT EXISTS device_store_access (
 device_id TEXT NOT NULL,
 store_id TEXT NOT NULL,
 granted_at TEXT NOT NULL,
 PRIMARY KEY(device_id,store_id),
 FOREIGN KEY(device_id) REFERENCES pos_devices(id),
 FOREIGN KEY(store_id) REFERENCES stores(id)
);
CREATE INDEX IF NOT EXISTS idx_device_store_access_store ON device_store_access(store_id,device_id);
INSERT OR IGNORE INTO device_store_access(device_id,store_id,granted_at)
 SELECT id,store_id,created_at FROM pos_devices WHERE store_id IS NOT NULL;
