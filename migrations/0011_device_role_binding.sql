-- V3 persistent-device auth prerequisite.
-- Apply only after 0010 and after reviewing existing devices.
-- Existing devices remain legacy-unbound and must be explicitly assigned a role
-- before passwordless renewal is enabled. Never infer role from client input.
ALTER TABLE pos_devices ADD COLUMN role TEXT CHECK(role IN ('pos','kitchen','scanner'));
CREATE INDEX IF NOT EXISTS idx_pos_devices_role_active ON pos_devices(id,role,active);

-- Pairing requests are short-lived, single-use and scoped to a browser secret.
CREATE TABLE IF NOT EXISTS device_pair_requests (
 id TEXT PRIMARY KEY,
 code TEXT NOT NULL UNIQUE,
 secret_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','expired')),
 device_id TEXT,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 FOREIGN KEY(device_id) REFERENCES pos_devices(id)
);
CREATE INDEX IF NOT EXISTS idx_device_pair_requests_expiry ON device_pair_requests(expires_at);
