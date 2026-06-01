/**
 * Streak pool API (Option A — Supabase).
 * GET /api/streak-pool?date=YYYY-MM-DD — daily rotation meta
 * GET /api/streak-pool?abId=gamePk_atBat — single AB payload
 *
 * Until bulk ingest, client uses bundled src/data/streak_pool.js.
 */

import { sendJson } from './_lib/http.js';
import { getSupabaseAdmin } from './_lib/supabase.js';
import { getDateKey } from './_lib/period.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    sendJson(res, 503, { error: 'Database not configured', source: 'bundle_fallback' });
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const abId = url.searchParams.get('abId');
    const dateKey = url.searchParams.get('date') || getDateKey();

    if (abId) {
      const { data, error } = await supabase
        .from('streak_at_bats')
        .select('id, game_pk, difficulty, tier, pitcher, batter, pitches, film_room_url, ump_scorecard_url')
        .eq('id', abId)
        .eq('eligible', true)
        .maybeSingle();

      if (error) {
        sendJson(res, 500, { error: error.message });
        return;
      }
      if (!data) {
        sendJson(res, 404, { error: 'AB not found' });
        return;
      }
      sendJson(res, 200, { ab: data, source: 'supabase' });
      return;
    }

    const { data: rotation, error: rotErr } = await supabase
      .from('streak_daily_rotations')
      .select('*')
      .eq('rotation_date', dateKey)
      .maybeSingle();

    if (rotErr) {
      sendJson(res, 500, { error: rotErr.message });
      return;
    }

    const { count, error: countErr } = await supabase
      .from('streak_at_bats')
      .select('id', { count: 'exact', head: true })
      .eq('eligible', true);

    if (countErr) {
      sendJson(res, 500, { error: countErr.message });
      return;
    }

    sendJson(res, 200, {
      rotationDate: dateKey,
      rotation: rotation || null,
      poolTotalAbs: count ?? 0,
      source: rotation ? 'supabase' : 'bundle_fallback',
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Streak pool request failed' });
  }
}
