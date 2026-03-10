-- openmud document sync manifest — version-aware sync with conflict detection
-- Run this in your Supabase SQL editor (Dashboard > SQL editor > New query > Run).
-- All statements are idempotent: safe to re-run if the table already exists.

-- Each row tracks a single document's sync state across devices.
-- The manifest enables delta sync: only changed files are transferred.
CREATE TABLE IF NOT EXISTS sync_manifest (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id  TEXT        NOT NULL,
  doc_id      TEXT        NOT NULL,
  doc_name    TEXT        NOT NULL DEFAULT '',
  folder_path TEXT        NOT NULL DEFAULT '',
  content_hash TEXT       NOT NULL DEFAULT '',
  byte_size   INTEGER     NOT NULL DEFAULT 0,
  version     INTEGER     NOT NULL DEFAULT 1,
  source      TEXT        NOT NULL DEFAULT 'web',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (user_id, project_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_manifest_project
  ON sync_manifest (user_id, project_id, updated_at DESC);

ALTER TABLE sync_manifest ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "users_read_own_manifest"
  ON sync_manifest FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "users_write_own_manifest"
  ON sync_manifest FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "users_update_own_manifest"
  ON sync_manifest FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "users_delete_own_manifest"
  ON sync_manifest FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "service_all_manifest"
  ON sync_manifest FOR ALL
  USING (true)
  WITH CHECK (true);

-- Conflict log: records detected conflicts for user review.
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id      TEXT        NOT NULL,
  doc_id          TEXT        NOT NULL,
  doc_name        TEXT        NOT NULL DEFAULT '',
  local_hash      TEXT        NOT NULL DEFAULT '',
  remote_hash     TEXT        NOT NULL DEFAULT '',
  local_version   INTEGER     NOT NULL DEFAULT 0,
  remote_version  INTEGER     NOT NULL DEFAULT 0,
  local_source    TEXT        NOT NULL DEFAULT '',
  remote_source   TEXT        NOT NULL DEFAULT '',
  resolution      TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_project
  ON sync_conflicts (user_id, project_id, created_at DESC);

ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "users_read_own_conflicts"
  ON sync_conflicts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "users_write_own_conflicts"
  ON sync_conflicts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "users_update_own_conflicts"
  ON sync_conflicts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "service_all_conflicts"
  ON sync_conflicts FOR ALL
  USING (true)
  WITH CHECK (true);
