-- openmud usage tracking — combined setup migration
-- Run this once in your Supabase SQL editor (Dashboard → SQL editor → New query → Run).
-- All statements are idempotent: safe to re-run if tables already exist.

-- ── usage_events ────────────────────────────────────────────────────────────
-- One row per AI request. Written by chat.js after every successful response.

CREATE TABLE IF NOT EXISTS usage_events (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  source            TEXT        NOT NULL DEFAULT 'web',   -- 'web' | 'desktop' | 'ios'
  model             TEXT        NOT NULL DEFAULT 'mud1',  -- model key used for this request
  input_tokens      INTEGER     NOT NULL DEFAULT 0,
  output_tokens     INTEGER     NOT NULL DEFAULT 0,
  -- Cost stored as microdollars (1 USD = 1,000,000) to avoid float precision issues.
  cost_microdollars INTEGER     NOT NULL DEFAULT 0,
  request_type      TEXT        NOT NULL DEFAULT 'chat'  -- 'chat' | 'estimate' | 'proposal'
);

-- Primary read pattern: all events for a user ordered by time
CREATE INDEX IF NOT EXISTS idx_usage_events_user_created
  ON usage_events (user_id, created_at DESC);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- Users read only their own events (service role bypasses RLS)
CREATE POLICY IF NOT EXISTS "users_read_own_usage_events"
  ON usage_events FOR SELECT
  USING (auth.uid() = user_id);

-- Server (service role key) can insert freely
CREATE POLICY IF NOT EXISTS "service_insert_usage_events"
  ON usage_events FOR INSERT
  WITH CHECK (true);


-- ── usage_daily ─────────────────────────────────────────────────────────────
-- One row per (user, date). Tracks daily message counts for plan limits.

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       DATE        NOT NULL,
  count      INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_date
  ON usage_daily (date DESC);

ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "users_read_own_usage_daily"
  ON usage_daily FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "service_insert_usage_daily"
  ON usage_daily FOR INSERT
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "service_update_usage_daily"
  ON usage_daily FOR UPDATE
  USING (true)
  WITH CHECK (true);


-- ── increment_usage_daily ────────────────────────────────────────────────────
-- Atomic upsert — inserts count=1 or increments existing row for today.
-- Returns the new count. Called by usage.js before each chat response.

CREATE OR REPLACE FUNCTION increment_usage_daily(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE    := (now() AT TIME ZONE 'utc')::date;
  v_count INTEGER;
BEGIN
  INSERT INTO usage_daily (user_id, date, count, created_at, updated_at)
  VALUES (p_user_id, v_today, 1, now(), now())
  ON CONFLICT (user_id, date)
  DO UPDATE
    SET count      = usage_daily.count + 1,
        updated_at = now()
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;

-- Only the service role can call this function
REVOKE ALL ON FUNCTION increment_usage_daily(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_usage_daily(UUID) TO service_role;
