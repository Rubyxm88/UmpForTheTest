/**
 * Server-side streak telemetry (Supabase).
 */

import { getSupabaseAdmin } from '../../api/_lib/supabase.js';
import { buildStreakRowsFromCsv } from './statcast-ingest.mjs';
import { fetchStatcastCsv } from './statcast-fetch.mjs';

async function ensureAbStatsRow(supabase, abId) {
  const { data } = await supabase.from('streak_ab_stats').select('ab_id').eq('ab_id', abId).maybeSingle();
  if (data) return;
  await supabase.from('streak_ab_stats').insert({ ab_id: abId });
}

export async function recordStreakAbServed(abId, handle) {
  if (!abId) return;
  const supabase = getSupabaseAdmin();
  await ensureAbStatsRow(supabase, abId);
  const { data: row } = await supabase.from('streak_ab_stats').select('*').eq('ab_id', abId).single();
  await supabase
    .from('streak_ab_stats')
    .update({
      times_served: (row.times_served || 0) + 1,
      last_played_at: new Date().toISOString(),
    })
    .eq('ab_id', abId);

  try {
    await supabase
      .from('streak_at_bats')
      .update({ last_used_date: new Date().toISOString().slice(0, 10) })
      .eq('id', abId);
  } catch {
    /* AB may exist only in client bundle until ingest */
  }
}

export async function recordStreakPitch(abId, { correct }) {
  if (!abId) return;
  const supabase = getSupabaseAdmin();
  await ensureAbStatsRow(supabase, abId);
  const { data: row } = await supabase.from('streak_ab_stats').select('*').eq('ab_id', abId).single();
  const patch = {
    pitches_seen: (row.pitches_seen || 0) + 1,
    last_played_at: new Date().toISOString(),
  };
  if (correct) patch.correct_calls = (row.correct_calls || 0) + 1;
  else patch.incorrect_calls = (row.incorrect_calls || 0) + 1;
  await supabase.from('streak_ab_stats').update(patch).eq('ab_id', abId);
}

export async function recordStreakAbCompleted(abId) {
  if (!abId) return;
  const supabase = getSupabaseAdmin();
  await ensureAbStatsRow(supabase, abId);
  const { data: row } = await supabase.from('streak_ab_stats').select('*').eq('ab_id', abId).single();
  await supabase
    .from('streak_ab_stats')
    .update({
      times_completed: (row.times_completed || 0) + 1,
      last_played_at: new Date().toISOString(),
    })
    .eq('ab_id', abId);
}

export async function recordStreakSessionEnd(handle, payload) {
  const supabase = getSupabaseAdmin();
  const {
    sessionId = null,
    dateKey,
    startedAt,
    correctStreak = 0,
    absPlayed = 0,
    pitchesCalled = 0,
    correctPitches = 0,
    usedAbIds = [],
    meta = {},
  } = payload;

  const row = {
    handle,
    date_key: dateKey || new Date().toISOString().slice(0, 10),
    started_at: startedAt || new Date().toISOString(),
    ended_at: new Date().toISOString(),
    correct_streak: correctStreak,
    abs_played: absPlayed,
    pitches_called: pitchesCalled,
    correct_pitches: correctPitches,
    used_ab_ids: usedAbIds,
    meta,
  };

  // Idempotency: when the client supplies a stable session id, upsert on it so
  // repeated session_end events for the same run collapse to a single row
  // instead of inserting duplicates.
  if (sessionId) {
    row.client_session_id = sessionId;
    const { data, error } = await supabase
      .from('streak_sessions')
      .upsert(row, { onConflict: 'client_session_id' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from('streak_sessions')
    .insert(row)
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function fetchStreakAdminDashboard() {
  const supabase = getSupabaseAdmin();

  const tables = {
    streak_at_bats: false,
    streak_daily_rotations: false,
    streak_ab_stats: false,
    streak_sessions: false,
  };

  for (const name of Object.keys(tables)) {
    const { error } = await supabase.from(name).select('id', { head: true, count: 'exact' }).limit(1);
    tables[name] = !error || !/does not exist|relation/i.test(error.message || '');
  }

  let poolCount = 0;
  let eligibleCount = 0;
  let rotationToday = null;

  if (tables.streak_at_bats) {
    const { count } = await supabase
      .from('streak_at_bats')
      .select('id', { count: 'exact', head: true });
    poolCount = count ?? 0;
    const { count: elig } = await supabase
      .from('streak_at_bats')
      .select('id', { count: 'exact', head: true })
      .eq('eligible', true);
    eligibleCount = elig ?? 0;
  }

  if (tables.streak_daily_rotations) {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from('streak_daily_rotations')
      .select('*')
      .eq('rotation_date', today)
      .maybeSingle();
    rotationToday = data;
  }

  let sessionCount = 0;
  let statsRowCount = 0;
  if (tables.streak_sessions) {
    const { count } = await supabase
      .from('streak_sessions')
      .select('id', { count: 'exact', head: true });
    sessionCount = count ?? 0;
  }
  if (tables.streak_ab_stats) {
    const { count } = await supabase
      .from('streak_ab_stats')
      .select('ab_id', { count: 'exact', head: true });
    statsRowCount = count ?? 0;
  }

  const ready20k =
    tables.streak_at_bats &&
    poolCount >= 1000 &&
    tables.streak_ab_stats &&
    tables.streak_sessions;

  return {
    tables,
    poolCount,
    eligibleCount,
    rotationToday,
    sessionCount,
    statsRowCount,
    ready20k,
    clientUsesSupabasePool: false,
    ingestCommand: 'npm run streak-pool:ingest',
  };
}

export async function listStreakAbsForAdmin({ page = 1, limit = 50, search = '', sort = 'times_served' }) {
  const supabase = getSupabaseAdmin();
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from('streak_at_bats')
    .select(
      'id, game_pk, difficulty, tier, eligible, pitcher, batter, game_title, metrics, last_used_date',
      { count: 'exact' }
    );

  if (search.trim()) {
    const q = `%${search.trim()}%`;
    query = query.or(`id.ilike.${q},pitcher.ilike.${q},batter.ilike.${q},game_title.ilike.${q}`);
  }

  if (sort === 'difficulty') {
    query = query.order('difficulty', { ascending: false });
  } else if (sort === 'last_used') {
    query = query.order('last_used_date', { ascending: false, nullsFirst: false });
  } else {
    query = query.order('id', { ascending: true });
  }

  query = query.range(from, to);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const ids = (data || []).map((r) => r.id);
  let statsMap = {};
  if (ids.length) {
    const { data: statsRows } = await supabase.from('streak_ab_stats').select('*').in('ab_id', ids);
    statsMap = Object.fromEntries((statsRows || []).map((s) => [s.ab_id, s]));
  }

  let rows = (data || []).map((row) => ({ ...row, stats: statsMap[row.id] || null }));
  if (sort === 'times_served') {
    rows = rows.sort(
      (a, b) => (b.stats?.times_served || 0) - (a.stats?.times_served || 0)
    );
  }

  return {
    rows,
    total: count ?? 0,
    page,
    limit,
  };
}

export async function listStreakSessionsForAdmin({ page = 1, limit = 30, handle = '' }) {
  const supabase = getSupabaseAdmin();
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from('streak_sessions')
    .select('*', { count: 'exact' })
    .order('ended_at', { ascending: false })
    .range(from, to);

  if (handle.trim()) {
    query = query.ilike('handle', `%${handle.trim()}%`);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  // Derive convenience fields for the admin UI (duration, accuracy).
  const rows = (data || []).map((r) => {
    const started = r.started_at ? new Date(r.started_at).getTime() : null;
    const ended = r.ended_at ? new Date(r.ended_at).getTime() : null;
    const durationSec = started && ended ? Math.max(0, Math.round((ended - started) / 1000)) : null;
    const accuracy = r.pitches_called > 0
      ? Math.round((100 * (r.correct_pitches || 0)) / r.pitches_called)
      : null;
    return { ...r, duration_sec: durationSec, accuracy };
  });

  return { rows, total: count ?? 0, page, limit };
}

/**
 * Difficulty distribution across the eligible pool, bucketed 0-9,10-19,…,90-100.
 * Powers the admin histogram.
 */
export async function fetchStreakDifficultyDistribution() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('streak_at_bats')
    .select('difficulty, tier, eligible')
    .eq('eligible', true);
  if (error) throw new Error(error.message);

  const buckets = Array.from({ length: 10 }, (_, i) => ({
    label: `${i * 10}-${i * 10 + 9}`,
    min: i * 10,
    max: i * 10 + 9,
    count: 0,
  }));
  const tiers = [0, 0, 0, 0, 0];
  let sum = 0;
  let n = 0;

  for (const r of data || []) {
    const d = Math.max(0, Math.min(99, Number(r.difficulty) || 0));
    buckets[Math.floor(d / 10)].count++;
    if (r.tier >= 1 && r.tier <= 5) tiers[r.tier - 1]++;
    sum += Number(r.difficulty) || 0;
    n++;
  }

  return {
    buckets,
    tiers,
    eligibleCount: n,
    avgDifficulty: n ? Math.round(sum / n) : 0,
  };
}

/**
 * Upsert scored AB rows into streak_at_bats (chunked). Idempotent on id.
 * @returns {{ upserted: number, errors: string[] }}
 */
export async function upsertStreakAbs(rows, { chunkSize = 200 } = {}) {
  const supabase = getSupabaseAdmin();
  let upserted = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from('streak_at_bats')
      .upsert(chunk, { onConflict: 'id' });
    if (error) errors.push(`rows ${i}-${i + chunk.length}: ${error.message}`);
    else upserted += chunk.length;
  }
  return { upserted, errors };
}

/**
 * Ingest a Statcast CSV string into the streak pool.
 * @returns combined parse summary + upsert result.
 */
export async function ingestStreakPoolFromCsvText(csvText, { minDifficulty = 0 } = {}) {
  const { rows, summary } = buildStreakRowsFromCsv(csvText);
  const filtered = minDifficulty > 0
    ? rows.filter((r) => r.difficulty >= minDifficulty)
    : rows;
  const { upserted, errors } = await upsertStreakAbs(filtered);
  return {
    ...summary,
    minDifficulty,
    inserted: upserted,
    skippedBelowMin: rows.length - filtered.length,
    errors,
  };
}

/**
 * Fetch Statcast by date range (server-side), score, and ingest into the pool.
 * @param {object} opts - { startDt, endDt, team, minDifficulty, maxDays }
 */
export async function ingestStreakPoolFromStatcast({
  startDt,
  endDt,
  team = '',
  minDifficulty = 0,
  maxDays = 14,
}) {
  if (!startDt || !endDt) throw new Error('startDt and endDt are required (YYYY-MM-DD).');

  const { csv, days } = await fetchStatcastCsv({ startDt, endDt, team, maxDays });
  const fetchedRows = days.reduce((acc, d) => acc + (d.rows || 0), 0);

  if (!csv) {
    return {
      startDt, endDt, team, fetchedRows, days,
      totalAbs: 0, eligible: 0, ineligible: 0, inserted: 0,
      rejectReasons: {}, tierCounts: [0, 0, 0, 0, 0], errors: [],
      note: 'No pitches returned for this range.',
    };
  }

  const result = await ingestStreakPoolFromCsvText(csv, { minDifficulty });
  return { startDt, endDt, team, fetchedRows, days, ...result };
}
