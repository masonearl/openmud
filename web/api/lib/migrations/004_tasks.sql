-- openmud tasks — first-class synced records
-- Run this in your Supabase SQL editor (Dashboard > SQL editor > New query > Run).
-- All statements are idempotent: safe to re-run if the table already exists.

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT        NOT NULL,
  project_id  TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL DEFAULT 'Untitled task',
  notes       TEXT        NOT NULL DEFAULT '',
  status      TEXT        NOT NULL DEFAULT 'open',
  priority    TEXT        NOT NULL DEFAULT 'medium',
  due_at      TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  source      TEXT        NOT NULL DEFAULT 'manual',
  version     INTEGER     NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_project
  ON tasks (user_id, project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_updated
  ON tasks (user_id, updated_at DESC);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "users_read_own_tasks"
  ON tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "users_insert_own_tasks"
  ON tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "users_update_own_tasks"
  ON tasks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "users_delete_own_tasks"
  ON tasks FOR DELETE
  USING (auth.uid() = user_id);

-- Service role can do everything (bypasses RLS)
CREATE POLICY IF NOT EXISTS "service_all_tasks"
  ON tasks FOR ALL
  USING (true)
  WITH CHECK (true);
