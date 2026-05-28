-- UmpSim3000 core schema (mirrors remote migration initial_umpsim_schema)

CREATE TABLE profiles (
  handle text PRIMARY KEY,
  pin_hash text NOT NULL,
  favorite_team text NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_handle_length CHECK (char_length(handle) >= 3)
);

CREATE TABLE user_stats (
  handle text PRIMARY KEY REFERENCES profiles (handle) ON DELETE CASCADE,
  xp integer NOT NULL DEFAULT 0,
  overall_accuracy integer,
  max_streak integer NOT NULL DEFAULT 0,
  completed_weekly integer NOT NULL DEFAULT 0,
  dnfs integer NOT NULL DEFAULT 0,
  stats_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leaderboard_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text NOT NULL,
  period_key text NOT NULL,
  handle text NOT NULL REFERENCES profiles (handle) ON DELETE CASCADE,
  team text NOT NULL DEFAULT 'none',
  accuracy text,
  score_raw integer NOT NULL DEFAULT 0,
  score_text text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leaderboard_board_check CHECK (board IN ('weekly', 'daily', 'alltime')),
  CONSTRAINT leaderboard_entries_unique_player UNIQUE (board, period_key, handle)
);

CREATE INDEX idx_leaderboard_board_period_score
  ON leaderboard_entries (board, period_key, score_raw DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER user_stats_set_updated_at
  BEFORE UPDATE ON user_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY leaderboard_public_select
  ON leaderboard_entries
  FOR SELECT
  TO anon, authenticated
  USING (true);
