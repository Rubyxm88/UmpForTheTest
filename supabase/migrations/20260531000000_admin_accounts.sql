-- Admin panel credentials (separate from player profiles)

CREATE TABLE IF NOT EXISTS admin_accounts (
  username text PRIMARY KEY,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_accounts ENABLE ROW LEVEL SECURITY;

-- No public policies: only service role (Vercel API) accesses this table
