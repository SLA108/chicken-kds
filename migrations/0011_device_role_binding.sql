-- V3 persistent-device auth prerequisite.
-- Apply only after 0010 and after reviewing existing devices.
-- Existing devices remain legacy-unbound and must be explicitly assigned a role
-- before passwordless renewal is enabled. Never infer role from client input.
ALTER TABLE pos_devices ADD COLUMN role TEXT CHECK(role IN ('pos','kitchen','scanner'));
CREATE INDEX IF NOT EXISTS idx_pos_devices_role_active ON pos_devices(id,role,active);
