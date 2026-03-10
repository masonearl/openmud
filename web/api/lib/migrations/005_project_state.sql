-- openmud pre-launch hardening — synced per-project chat/task state

CREATE TABLE IF NOT EXISTS project_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  chats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_chat_id TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_state_user_updated
  ON project_state (user_id, updated_at DESC);

ALTER TABLE project_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "service_manage_project_state"
  ON project_state
  USING (true)
  WITH CHECK (true);
