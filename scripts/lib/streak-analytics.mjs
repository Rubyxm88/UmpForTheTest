/**
 * Server-side streak telemetry (Supabase).
 */

import { getSupabaseAdmin } from '../../api/_lib/supabase.js';

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
    dateKey,
    startedAt,
    correctStreak = 0,
    absPlayed = 0,
    pitchesCalled = 0,
    correctPitches = 0,
    usedAbIds = [],
    meta = {},
  } = payload;

  const { data, error } = await supabase
    .from('streak_sessions')
    .insert({
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
    })
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
  return { rows: data || [], total: count ?? 0, page, limit };
}
