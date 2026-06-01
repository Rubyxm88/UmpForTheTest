-- Weekly challenge bundles + week assignments (admin / serverless writable store)

CREATE TABLE weekly_challenge_bundles (
  id text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  games jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE weekly_challenge_assignments (
  week_id text PRIMARY KEY,
  bundle_id text NOT NULL REFERENCES weekly_challenge_bundles (id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by text
);

CREATE INDEX idx_weekly_challenge_assignments_bundle
  ON weekly_challenge_assignments (bundle_id);

CREATE TRIGGER weekly_challenge_bundles_set_updated_at
  BEFORE UPDATE ON weekly_challenge_bundles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE weekly_challenge_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_challenge_assignments ENABLE ROW LEVEL SECURITY;
