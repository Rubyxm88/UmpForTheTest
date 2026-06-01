/** Shared Supabase + Vercel project identifiers (UmpSim3000). */

export const SUPABASE_PROJECT_REF = 'wrtwqfvicftxpduukzwm';
export const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
export const VERCEL_PROJECT_NAME = 'umpsim3000';

/** Tables required for admin weekly + streak + core game APIs. */
export const REQUIRED_TABLES = [
  'profiles',
  'user_stats',
  'leaderboard_entries',
  'admin_accounts',
  'weekly_challenge_bundles',
  'weekly_challenge_assignments',
  'streak_at_bats',
  'streak_daily_rotations',
  'streak_ab_stats',
  'streak_sessions',
];

/** Optional analytics schema (v3); not required for weekly player flow. */
export const OPTIONAL_TABLES = [
  'challenges',
  'challenge_at_bats',
  'challenge_pitches',
  'pitch_attempts',
  'feedback',
  'script_runs',
];

export const LOCAL_MIGRATION_NAMES = [
  'initial_umpsim_schema',
  'v3_challenge_analytics',
  'admin_accounts',
  'streak_pool',
  'weekly_challenge_admin',
  'streak_analytics',
];
