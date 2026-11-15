-- Explicit per-device permission to display staff attendance QR.
-- No existing device is authorized by default.
CREATE TABLE IF NOT EXISTS device_attendance_qr_access (
 device_id TEXT PRIMARY KEY REFERENCES pos_devices(id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
