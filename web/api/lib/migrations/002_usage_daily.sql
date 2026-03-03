-- openmud usage_daily table + atomic increment RPC
-- Run this in your Supabase SQL editor after 001_usage_events.sql.
-- Tracks per-user daily message counts used for plan limits.

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       DATE        NOT NULL,
  count      INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

-- Optional helper index for date-range admin queries
CREATE INDEX IF NOT EXISTS idx_usage_daily_date
  ON usage_daily (date DESC);

-- Atomic daily increment. Inserts (count=1) or increments existing row.
-- Returns the new count for the current UTC day.
CREATE OR REPLACE FUNCTION increment_usage_daily(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'utc')::date;
  v_count INTEGER;
BEGIN
  INSERT INTO usage_daily (user_id, date, count, created_at, updated_at)
  VALUES (p_user_id, v_today, 1, now(), now())
  ON CONFLICT (user_id, date)
  DO UPDATE
    SET count = usage_daily.count + 1,
        updated_at = now()
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION increment_usage_daily(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_usage_daily(UUID) TO service_role;

ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;

-- Users can read only their own daily usage rows.
CREATE POLICY "users_read_own_usage_daily"
  ON usage_daily FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can insert/update rows (server-side usage allocator).
CREATE POLICY "service_insert_usage_daily"
  ON usage_daily FOR INSERT
  WITH CHECK (true);

CREATE POLICY "service_update_usage_daily"
  ON usage_daily FOR UPDATE
  USING (true)
  WITH CHECK (true);
