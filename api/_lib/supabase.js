import { createClient } from '@supabase/supabase-js';

let adminClient = null;

export function getSupabaseAdmin() {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export function rowToClientStats(row) {
  if (!row) return null;
  const json = row.stats_json && typeof row.stats_json === 'object' ? row.stats_json : {};
  return {
    ...json,
    xp: row.xp ?? json.xp ?? 0,
    overallAccuracy: row.overall_accuracy ?? json.overallAccuracy ?? null,
    maxStreak: row.max_streak ?? json.maxStreak ?? 0,
    completedWeekly: row.completed_weekly ?? json.completedWeekly ?? 0,
    dnfs: row.dnfs ?? json.dnfs ?? 0,
    favoriteTeam: json.favoriteTeam ?? 'none',
    history: json.history ?? [],
    dailyHistory: json.dailyHistory ?? {},
    teamStats: json.teamStats ?? {},
  };
}

export function clientStatsToRow(handle, stats) {
  const safe = stats && typeof stats === 'object' ? stats : {};
  return {
    handle,
    xp: Number(safe.xp) || 0,
    overall_accuracy:
      safe.overallAccuracy === null || safe.overallAccuracy === undefined
        ? null
        : Number(safe.overallAccuracy),
    max_streak: Number(safe.maxStreak) || 0,
    completed_weekly: Number(safe.completedWeekly) || 0,
    dnfs: Number(safe.dnfs) || 0,
    stats_json: {
      history: safe.history ?? [],
      dailyHistory: safe.dailyHistory ?? {},
      teamStats: safe.teamStats ?? {},
      favoriteTeam: safe.favoriteTeam ?? 'none',
    },
  };
}
