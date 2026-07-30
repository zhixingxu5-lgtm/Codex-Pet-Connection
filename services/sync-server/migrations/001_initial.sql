CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  pairing_attempts INTEGER NOT NULL DEFAULT 0,
  pairing_attempt_window_started TIMESTAMPTZ
);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS pairing_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS pairing_attempt_window_started TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS pairing_codes (
  id UUID PRIMARY KEY,
  creator_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  claimed_by UUID REFERENCES devices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pairings (
  id UUID PRIMARY KEY,
  device_a UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  device_b UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT pair_distinct_devices CHECK (device_a <> device_b)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_pairing_per_device_a ON pairings(device_a);
CREATE UNIQUE INDEX IF NOT EXISTS one_pairing_per_device_b ON pairings(device_b);

CREATE TABLE IF NOT EXISTS pet_state_snapshots (
  owner_device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS pairing_codes_expiry_idx ON pairing_codes(expires_at);
