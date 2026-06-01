-- V3 challenge analytics (normalized challenges + pitch attempts)
-- Already applied on production; kept in repo for fresh projects and supabase db push.

CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  period_key text NOT NULL,
  title text NOT NULL,
  description text,
  film_room_url text,
  ump_scorecard_url text,
  published_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenges_type_check CHECK (type IN ('weekly', 'daily', 'custom')),
  CONSTRAINT challenges_type_period_unique UNIQUE (type, period_key)
);

CREATE TABLE IF NOT EXISTS challenge_at_bats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
  ab_index integer NOT NULL,
  game_id text,
  matchup text,
  inning integer,
  is_top boolean,
  outs integer,
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_at_bats_unique_index UNIQUE (challenge_id, ab_index)
);

CREATE TABLE IF NOT EXISTS challenge_pitches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at_bat_id uuid NOT NULL REFERENCES challenge_at_bats (id) ON DELETE CASCADE,
  pitch_index integer NOT NULL,
  game_datetime timestamptz,
  mlb_game_id text,
  pitch_type text,
  speed_mph numeric,
  release_pos_x numeric,
  release_pos_y numeric,
  release_pos_z numeric,
  vx0 numeric,
  vy0 numeric,
  vz0 numeric,
  ax numeric,
  ay numeric,
  az numeric,
  sz_top numeric,
  sz_bot numeric,
  plate_x numeric,
  plate_z numeric,
  real_ump_call text,
  abs_call text,
  is_swing boolean NOT NULL DEFAULT false,
  swing_outcome text,
  swing_hit_type text,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_pitches_unique_index UNIQUE (at_bat_id, pitch_index),
  CONSTRAINT challenge_pitches_call_check CHECK (
    abs_call IS NULL OR abs_call IN ('strike', 'ball')
  )
);

CREATE TABLE IF NOT EXISTS pitch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL REFERENCES profiles (handle) ON DELETE CASCADE,
  challenge_id uuid REFERENCES challenges (id) ON DELETE SET NULL,
  challenge_pitch_id uuid REFERENCES challenge_pitches (id) ON DELETE SET NULL,
  user_call text NOT NULL,
  correct_abs boolean,
  correct_ump boolean,
  latency_ms integer,
  game_mode text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text REFERENCES profiles (handle) ON DELETE SET NULL,
  message text NOT NULL,
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS script_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_name text NOT NULL,
  status text NOT NULL,
  log_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT script_runs_status_check CHECK (status IN ('running', 'ok', 'error'))
);

ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_at_bats ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_pitches ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_runs ENABLE ROW LEVEL SECURITY;
