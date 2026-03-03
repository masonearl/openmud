-- openmud usage_events table
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query)
-- Tracks every AI request across web, desktop, and iOS (future).

CREATE TABLE IF NOT EXISTS usage_events (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  source          TEXT        NOT NULL DEFAULT 'web',   -- 'web' | 'desktop' | 'ios'
  model           TEXT        NOT NULL DEFAULT 'mud1',  -- model key used
  input_tokens    INTEGER     NOT NULL DEFAULT 0,
  output_tokens   INTEGER     NOT NULL DEFAULT 0,
  -- Cost stored in microdollars (1 USD = 1,000,000) to avoid float precision issues.
  -- Compute server-side using MODEL_PRICING in usage.js.
  cost_microdollars INTEGER   NOT NULL DEFAULT 0,
  request_type    TEXT        NOT NULL DEFAULT 'chat'  -- 'chat' | 'estimate' | 'proposal'
);

-- Primary query pattern: user's events ordered by time
-- This index also serves daily rollup queries via range scans on created_at.
CREATE INDEX IF NOT EXISTS idx_usage_events_user_created
  ON usage_events (user_id, created_at DESC);

-- Enable row-level security
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- Users can read only their own events
CREATE POLICY "users_read_own_usage_events"
  ON usage_events FOR SELECT
  USING (auth.uid() = user_id);

-- Service role (server) can insert freely (anon key cannot write)
CREATE POLICY "service_insert_usage_events"
  ON usage_events FOR INSERT
  WITH CHECK (true);
