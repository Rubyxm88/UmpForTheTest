/**
 * Weekly challenge analytics for admin (leaderboard + per-AB progress from user_stats).
 */

import { getSupabaseAdmin } from '../../api/_lib/supabase.js';
import { buildWeeklyPlaylist } from '../../src/js/weekly-playlist.js';
import { explainWeeklyPlaylist } from '../../src/js/weekly-playlist.js';
import { getCrossingTime, getBallPositionAtTime } from '../../src/js/physics.js';

function pitchIsBorderline(pitch, edgeFt = 0.15) {
  if (pitch.vx0 == null || pitch.ay == null) return false;
  const tCross = getCrossingTime(pitch);
  const cross = getBallPositionAtTime(pitch, tCross);
  const xEdge = Math.abs(Math.abs(cross.x) - 0.8283);
  const yBot = Math.abs(cross.y - (pitch.sz_bot - 0.12));
  const yTop = Math.abs(cross.y - (pitch.sz_top + 0.12));
  return xEdge <= edgeFt || Math.min(yBot, yTop) <= edgeFt;
}

export function summarizePitchesForAdmin(pitches = []) {
  return pitches.map((p, i) => ({
    index: i + 1,
    pitchType: p.pitch_type || '—',
    speedMph: p.speed_mph ?? null,
    realCall: p.real_ump_call || '—',
    absCall: p.abs_call || p.real_ump_call || '—',
    isSwing: !!p.is_swing,
    swingOutcome: p.swing_outcome || null,
    isBorderline: pitchIsBorderline(p),
    countAfter: p.count_balls != null ? `${p.count_balls}-${p.count_strikes}` : null,
    blurb: p.historical_blurb || '',
  }));
}

export function getBundleAbDetail(bundle, playOrder) {
  if (!bundle?.games?.length || !playOrder) return null;
  const order = Number(playOrder);
  if (!Number.isFinite(order) || order < 1) return null;

  const config = bundle.meta?.generation || null;
  const explained = explainWeeklyPlaylist(bundle.games, bundle.meta || {}, config);
  const playlist = buildWeeklyPlaylist(bundle.games, bundle.meta || {}, config);
  const abMeta = explained.selectedAtBats[order - 1];
  const abData = playlist[order - 1];
  if (!abMeta && !abData) return null;

  const pitches = abData?.pitches || [];
  return {
    playOrder: order,
    gameTitle: abMeta?.gameTitle || abData?.gameTitle,
    batter: abMeta?.batter || abData?.batter,
    pitcher: abMeta?.pitcher || abData?.pitcher,
    pitchCount: pitches.length,
    endingCount: abMeta?.endingCount,
    abResult: abMeta?.abResult,
    reasonCode: abMeta?.reasonCode,
    reasonDetail: abMeta?.reasonDetail,
    isComplete: abMeta?.isComplete !== false,
    pitches: summarizePitchesForAdmin(pitches),
    filmRoomUrl: abData?.filmRoomUrl,
    umpScorecardUrl: abData?.umpScorecardUrl,
  };
}

export async function aggregateWeeklyAbAnalytics(weekId, bundleId = null) {
  const supabase = getSupabaseAdmin();
  const targetAbs = 20;

  const { data: lbRows, error: lbErr } = await supabase
    .from('leaderboard_entries')
    .select('handle, team, accuracy, score_raw, score_text, submitted_at')
    .eq('board', 'weekly')
    .eq('period_key', weekId)
    .order('score_raw', { ascending: false });

  if (lbErr) throw new Error(lbErr.message);

  const { data: statRows, error: stErr } = await supabase
    .from('user_stats')
    .select('handle, stats_json, completed_weekly');

  if (stErr) throw new Error(stErr.message);

  const perAb = {};
  for (let i = 1; i <= targetAbs; i++) {
    perAb[i] = {
      playOrder: i,
      reached: 0,
      completed: 0,
      correct: 0,
      called: 0,
      handles: [],
    };
  }

  let activePlayers = 0;
  let finishedPlayers = 0;

  for (const row of statRows || []) {
    const cp = row.stats_json?.challengeProgress;
    if (!cp?.weeklyPlaylistABs?.length) continue;
    if (cp.weeklyChallengeWeekId && cp.weeklyChallengeWeekId !== weekId) continue;
    if (bundleId && cp.weeklyBundleRevision && !String(cp.weeklyBundleRevision).includes(bundleId)) {
      continue;
    }

    activePlayers += 1;
    const playlist = cp.weeklyPlaylistABs;
    let allDone = true;

    playlist.forEach((ab, idx) => {
      const order = idx + 1;
      if (order > targetAbs || !perAb[order]) return;

      const pitches = ab.pitches || [];
      const hasProgress = ab.completed || pitches.some((p) => p.userCall !== undefined);
      if (!hasProgress) return;

      perAb[order].reached += 1;
      if (ab.completed) perAb[order].completed += 1;
      else allDone = false;

      pitches.forEach((p) => {
        if (p.userCall !== undefined && !p.is_swing && !p.isSwingPlay) {
          perAb[order].called += 1;
          if (p.userCorrect) perAb[order].correct += 1;
        }
      });
    });

    if (playlist.filter((ab) => ab.completed).length >= targetAbs) {
      finishedPlayers += 1;
    }
  }

  const perAbList = Object.values(perAb).map((slot) => ({
    ...slot,
    accuracy:
      slot.called > 0 ? Math.round((slot.correct / slot.called) * 100) : null,
    reachRate:
      activePlayers > 0 ? Math.round((slot.reached / activePlayers) * 100) : null,
  }));

  return {
    weekId,
    bundleId,
    leaderboardCount: lbRows?.length || 0,
    leaderboard: (lbRows || []).slice(0, 25),
    activePlayers,
    finishedPlayers,
    perAb: perAbList,
  };
}
