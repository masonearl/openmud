-- openmud pre-launch hardening — desktop auth handoff codes
-- Run after the combined setup migration.

CREATE TABLE IF NOT EXISTS desktop_auth_handoffs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_desktop_auth_handoffs_user_created
  ON desktop_auth_handoffs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_desktop_auth_handoffs_expires
  ON desktop_auth_handoffs (expires_at DESC);

ALTER TABLE desktop_auth_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "service_manage_desktop_auth_handoffs"
  ON desktop_auth_handoffs
  USING (true)
  WITH CHECK (true);
