import { createClient } from '@supabase/supabase-js';

let adminClient = null;

export const SUPABASE_SETUP_HINT =
  'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on Vercel (copy service_role from Supabase dashboard). See docs/SUPABASE_SETUP.md — do not use the Vercel Supabase marketplace integration for this project.';

/** Vercel Marketplace uses SUPABASE_SECRET_KEY; manual setup uses SUPABASE_SERVICE_ROLE_KEY. */
export function resolveSupabaseEnv() {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    '';
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    '';
  return { url, serviceKey };
}

export function isSupabaseConfigured() {
  const { url, serviceKey } = resolveSupabaseEnv();
  if (!url || !serviceKey) return false;
  if (/your_service_role|placeholder|changeme/i.test(serviceKey)) return false;
  return true;
}

export function tryGetSupabaseAdmin() {
  if (!isSupabaseConfigured()) return null;
  return getSupabaseAdmin();
}

export function getSupabaseAdmin() {
  if (adminClient) return adminClient;

  const { url, serviceKey } = resolveSupabaseEnv();
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or install the Vercel Supabase integration — it provides SUPABASE_SECRET_KEY).'
    );
  }

  adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

const LEADERBOARD_BOARD_PRIORITY = { alltime: 0, weekly: 1, daily: 2 };

/** Parse "67", 67, or "67%" into an integer percent. */
export function parseAccuracyValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return Math.round(value);
  const str = String(value).trim();
  if (!str) return null;
  const match = str.match(/(\d+(?:\.\d+)?)/);
  return match ? Math.round(Number(match[1])) : null;
}

/** Best accuracy from leaderboard rows (prefers all-time, then weekly, then daily). */
export function pickLeaderboardAccuracy(entries) {
  if (!entries?.length) return null;
  let best = null;
  let bestPriority = 99;
  for (const entry of entries) {
    const acc = parseAccuracyValue(entry.accuracy);
    if (acc == null) continue;
    const priority = LEADERBOARD_BOARD_PRIORITY[entry.board] ?? 99;
    if (priority < bestPriority) {
      best = acc;
      bestPriority = priority;
    }
  }
  return best;
}

/**
 * Resolve display accuracy from column, stats_json, session history, or leaderboard.
 */
export function deriveOverallAccuracy(row, leaderboardAccuracy = null) {
  if (!row) {
    if (leaderboardAccuracy != null) {
      return { value: leaderboardAccuracy, source: 'leaderboard' };
    }
    return { value: null, source: null };
  }

  const json = row.stats_json && typeof row.stats_json === 'object' ? row.stats_json : {};

  const lifetimeTotal = Number(json.lifetimeTotalCalls) || 0;
  if (lifetimeTotal > 0) {
    const lifetimeCorrect = Number(json.lifetimeCorrectCalls) || 0;
    return {
      value: Math.round((lifetimeCorrect / lifetimeTotal) * 100),
      source: 'stored',
    };
  }

  for (const candidate of [row.overall_accuracy, json.overallAccuracy]) {
    const parsed = parseAccuracyValue(candidate);
    if (parsed != null) return { value: parsed, source: 'stored' };
  }

  const history = json.history;
  if (Array.isArray(history) && history.length) {
    let correct = 0;
    let total = 0;
    for (const session of history) {
      correct += Number(session.correctCalls) || 0;
      total += Number(session.totalCalls) || 0;
    }
    if (total > 0) {
      return { value: Math.round((correct / total) * 100), source: 'history' };
    }
  }

  const bestWeekly = json.bestWeeklyRecord;
  if (bestWeekly && typeof bestWeekly === 'object') {
    const fromBest = parseAccuracyValue(bestWeekly.accuracy);
    if (fromBest != null) return { value: fromBest, source: 'history' };
  }

  if (leaderboardAccuracy != null) {
    return { value: leaderboardAccuracy, source: 'leaderboard' };
  }

  return { value: null, source: null };
}

export function rowToClientStats(row, leaderboardEntries = null) {
  if (!row) return null;
  const json = row.stats_json && typeof row.stats_json === 'object' ? row.stats_json : {};
  const lbAcc = pickLeaderboardAccuracy(leaderboardEntries);
  const { value: overallAccuracy, source: accuracySource } = deriveOverallAccuracy(
    row,
    lbAcc
  );

  return {
    ...json,
    xp: row.xp ?? json.xp ?? 0,
    overallAccuracy,
    accuracySource,
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
      recentPitches: safe.recentPitches ?? [],
      totalPitchesCalled: safe.totalPitchesCalled ?? 0,
      lifetimeTotalCalls: safe.lifetimeTotalCalls ?? safe.totalPitchesCalled ?? 0,
      lifetimeCorrectCalls: safe.lifetimeCorrectCalls ?? 0,
      bestWeeklyRecord: safe.bestWeeklyRecord ?? null,
      streakHistory: safe.streakHistory ?? {},
      streakAttempts: Array.isArray(safe.streakAttempts) ? safe.streakAttempts.slice(0, 20) : [],
      challengeProgress: safe.challengeProgress ?? null,
      xp: safe.xp ?? 0,
      overallAccuracy:
        safe.overallAccuracy === null || safe.overallAccuracy === undefined
          ? null
          : Number(safe.overallAccuracy),
    },
  };
}
