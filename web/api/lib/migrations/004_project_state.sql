-- openmud project_state table
-- Run this in your Supabase SQL editor after the projects table exists.
-- Stores durable per-project structured data (facts, bid items, workflow state).

CREATE TABLE IF NOT EXISTS project_state (
  project_id  TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_state_user_updated
  ON project_state (user_id, updated_at DESC);

ALTER TABLE project_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_state'
      AND policyname = 'users_read_own_project_state'
  ) THEN
    CREATE POLICY "users_read_own_project_state"
      ON project_state FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_state'
      AND policyname = 'users_insert_own_project_state'
  ) THEN
    CREATE POLICY "users_insert_own_project_state"
      ON project_state FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_state'
      AND policyname = 'users_update_own_project_state'
  ) THEN
    CREATE POLICY "users_update_own_project_state"
      ON project_state FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_state'
      AND policyname = 'users_delete_own_project_state'
  ) THEN
    CREATE POLICY "users_delete_own_project_state"
      ON project_state FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END
$$;
