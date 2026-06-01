-- Streak play analytics (sessions + per-AB aggregates for admin)

CREATE TABLE IF NOT EXISTS streak_ab_stats (
  ab_id text PRIMARY KEY,
  times_served integer NOT NULL DEFAULT 0,
  times_completed integer NOT NULL DEFAULT 0,
  pitches_seen integer NOT NULL DEFAULT 0,
  correct_calls integer NOT NULL DEFAULT 0,
  incorrect_calls integer NOT NULL DEFAULT 0,
  last_played_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS streak_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL REFERENCES profiles (handle) ON DELETE CASCADE,
  date_key date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NOT NULL DEFAULT now(),
  correct_streak integer NOT NULL DEFAULT 0,
  abs_played integer NOT NULL DEFAULT 0,
  pitches_called integer NOT NULL DEFAULT 0,
  correct_pitches integer NOT NULL DEFAULT 0,
  used_ab_ids text[] NOT NULL DEFAULT '{}',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_streak_sessions_handle_date
  ON streak_sessions (handle, date_key DESC);

CREATE INDEX IF NOT EXISTS idx_streak_sessions_ended
  ON streak_sessions (ended_at DESC);

CREATE TRIGGER streak_ab_stats_set_updated_at
  BEFORE UPDATE ON streak_ab_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE streak_ab_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_sessions ENABLE ROW LEVEL SECURITY;
