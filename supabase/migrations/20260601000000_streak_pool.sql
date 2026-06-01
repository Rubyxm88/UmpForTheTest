-- Streak Challenge AB pool (Option A: Supabase-backed 20k+ catalog)
-- Client bundle holds manifest until bulk ingest; API serves pitch payloads by id.

CREATE TABLE IF NOT EXISTS streak_at_bats (
  id text PRIMARY KEY,
  game_pk bigint,
  at_bat_number integer,
  difficulty smallint NOT NULL CHECK (difficulty BETWEEN 0 AND 100),
  tier smallint NOT NULL CHECK (tier BETWEEN 0 AND 5),
  eligible boolean NOT NULL DEFAULT true,
  reject_reason text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  pitcher text,
  batter text,
  game_title text,
  film_room_url text,
  ump_scorecard_url text,
  pitches jsonb NOT NULL,
  last_used_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_streak_at_bats_eligible_difficulty
  ON streak_at_bats (eligible, difficulty)
  WHERE eligible = true;

CREATE INDEX IF NOT EXISTS idx_streak_at_bats_last_used
  ON streak_at_bats (last_used_date);

CREATE TABLE IF NOT EXISTS streak_daily_rotations (
  rotation_date date PRIMARY KEY,
  week_id text NOT NULL,
  shuffle_seed bigint NOT NULL,
  daily_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  pool_version text,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER streak_at_bats_set_updated_at
  BEFORE UPDATE ON streak_at_bats
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE streak_at_bats ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_daily_rotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY streak_at_bats_public_select
  ON streak_at_bats
  FOR SELECT
  TO anon, authenticated
  USING (eligible = true);

CREATE POLICY streak_daily_rotations_public_select
  ON streak_daily_rotations
  FOR SELECT
  TO anon, authenticated
  USING (true);
