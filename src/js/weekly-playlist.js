/**
 * Build the weekly challenge playlist from curated game pitch data.
 */

import { getCrossingTime, getBallPositionAtTime } from './physics.js';
import { resolvePlaylistOptions } from './weekly-generation-config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function mulberry32Random() {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isCalledPitch(pitch) {
  if (pitch.is_swing) return false;
  const code = pitch.real_ump_call;
  return code === 'B' || code === 'S';
}

function abPassesFilters(ab, filters, playlistOpts) {
  const pitches = ab.pitches || [];
  if (pitches.length < (playlistOpts.minPitchesPerAb || 1)) return false;
  if (playlistOpts.maxPitchesPerAb != null && pitches.length > playlistOpts.maxPitchesPerAb) return false;

  const calledCount = pitches.filter(isCalledPitch).length;
  if (filters.requireCalledPitch && calledCount < (filters.minCalledPitchesPerAb || 1)) return false;
  if (filters.excludeSwingOnlyAbs && calledCount === 0) return false;
  return true;
}

function abHasBorderlinePitch(ab, edgeFt) {
  return (ab.pitches || []).some((p) => {
    if (p.vx0 == null || p.ay == null) return false;
    const tCross = getCrossingTime(p);
    const crossPoint = getBallPositionAtTime(p, tCross);
    const xEdgeDist = Math.abs(Math.abs(crossPoint.x) - 0.8283);
    const yBotDist = Math.abs(crossPoint.y - (p.sz_bot - 0.12));
    const yTopDist = Math.abs(crossPoint.y - (p.sz_top + 0.12));
    const yEdgeDist = Math.min(yBotDist, yTopDist);
    return xEdgeDist <= edgeFt || yEdgeDist <= edgeFt;
  });
}

function groupGamesIntoAbs(games) {
  const allAbs = [];
  games.forEach((game, gameIdx) => {
    let currentPitches = [];
    let currentBatter = '';

    const flushAb = () => {
      if (!currentPitches.length) return;
      allAbs.push({
        gameIndex: gameIdx,
        gameTitle: game.title,
        filmRoomUrl: game.film_room_url,
        umpScorecardUrl: game.ump_scorecard_url,
        pitches: currentPitches,
        batter: currentPitches[0].batter,
        pitcher: currentPitches[0].pitcher,
        maxInning: Math.max(...currentPitches.map((p) => p.inning || 1)),
      });
      currentPitches = [];
    };

    (game.pitches || []).forEach((pitch) => {
      if (pitch.batter !== currentBatter && currentPitches.length > 0) flushAb();
      currentBatter = pitch.batter;
      currentPitches.push(pitch);
    });
    flushAb();
  });
  return allAbs;
}

function deterministicShuffle(arr, rand) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function abKey(ab) {
  const p0 = ab.pitches?.[0];
  return `${ab.gameIndex}:${ab.batter}:${ab.pitcher}:${p0?.id ?? ''}`;
}

function applyPerGameCap(selected, cap) {
  if (!cap || cap < 1) return selected;
  const counts = new Map();
  const out = [];
  for (const ab of selected) {
    const gi = ab.gameIndex ?? 0;
    const n = counts.get(gi) || 0;
    if (n >= cap) continue;
    counts.set(gi, n + 1);
    out.push(ab);
  }
  return out;
}

/**
 * @param {object[]} games - WEEKLY_CHALLENGE_DATA shape
 * @param {object} meta - WEEKLY_CHALLENGE_META (+ generation)
 * @param {import('./weekly-generation-config.js').DEFAULT_WEEKLY_GENERATION_CONFIG} [config]
 */
export function buildWeeklyPlaylist(games, meta, config) {
  const playlistOpts = resolvePlaylistOptions(meta, config);
  const filters = playlistOpts.filters || {};
  const edgeFt = playlistOpts.borderlineEdgeThresholdFt ?? 0.15;
  const target = Math.max(1, playlistOpts.targetAtBats || 20);
  const borderlineTarget = Math.round(target * (playlistOpts.borderlineRatio ?? 0.5));
  const normalTarget = target - borderlineTarget;

  const candidates = groupGamesIntoAbs(games).filter((ab) => abPassesFilters(ab, filters, playlistOpts));

  const borderlineABs = [];
  const normalABs = [];
  candidates.forEach((ab) => {
    const entry = { ...ab, completed: false, userCorrectCount: 0, userTotalCount: 0 };
    if (abHasBorderlinePitch(ab, edgeFt)) borderlineABs.push(entry);
    else normalABs.push(entry);
  });

  const seed = Number(playlistOpts.shuffleSeed) || Number(meta?.shuffleSeed) || 20260101;
  const rand = mulberry32(seed);

  let borderlinePool = deterministicShuffle(borderlineABs, rand);
  let normalPool = deterministicShuffle(normalABs, rand);

  if (playlistOpts.prioritizeLateInning) {
    const lateSort = (a, b) => (b.maxInning || 0) - (a.maxInning || 0);
    borderlinePool = borderlinePool.sort(lateSort);
    normalPool = normalPool.sort(lateSort);
  }

  let selectedBorderline = borderlinePool.slice(0, borderlineTarget);
  let selectedNormal = normalPool.slice(0, normalTarget);

  if (selectedBorderline.length < borderlineTarget) {
    const needed = borderlineTarget - selectedBorderline.length;
    selectedNormal = selectedNormal.concat(normalPool.slice(normalTarget, normalTarget + needed));
  } else if (selectedNormal.length < normalTarget) {
    const needed = normalTarget - selectedNormal.length;
    selectedBorderline = selectedBorderline.concat(
      borderlinePool.slice(borderlineTarget, borderlineTarget + needed)
    );
  }

  let playlist = selectedBorderline.concat(selectedNormal).slice(0, target);
  playlist = applyPerGameCap(playlist, playlistOpts.perGameCap);
  if (playlist.length < target) {
    const usedKeys = new Set(playlist.map(abKey));
    const remainder = deterministicShuffle(
      candidates.filter((ab) => !usedKeys.has(abKey(ab))),
      rand
    );
    for (const ab of remainder) {
      if (playlist.length >= target) break;
      const entry = { ...ab, completed: false, userCorrectCount: 0, userTotalCount: 0 };
      playlist.push(entry);
      usedKeys.add(abKey(ab));
    }
    playlist = applyPerGameCap(playlist.slice(0, target), playlistOpts.perGameCap);
  }

  return deterministicShuffle(playlist, rand);
}

/**
 * Player-facing playlist order with per-AB selection reasons (matches buildWeeklyPlaylist).
 */
export function explainWeeklyPlaylist(games, meta, config) {
  const playlistOpts = resolvePlaylistOptions(meta, config);
  const edgeFt = playlistOpts.borderlineEdgeThresholdFt ?? 0.15;
  const target = Math.max(1, playlistOpts.targetAtBats || 20);
  const borderlineTarget = Math.round(target * (playlistOpts.borderlineRatio ?? 0.5));
  const normalTarget = target - borderlineTarget;
  const seed = Number(playlistOpts.shuffleSeed) || Number(meta?.shuffleSeed) || 20260101;

  const playlist = buildWeeklyPlaylist(games, meta, config);
  const stats = summarizePlaylistBuild(games, meta, config);

  const capNote =
    playlistOpts.perGameCap && playlistOpts.perGameCap > 0
      ? ` Max ${playlistOpts.perGameCap} ABs per game.`
      : '';
  const lateNote = playlistOpts.prioritizeLateInning ? ' Late-inning ABs prioritized in pool order.' : '';

  const selectedAtBats = playlist.map((ab, i) => {
    const isBl = abHasBorderlinePitch(ab, edgeFt);
    const inning = ab.maxInning ? ` · inn ${ab.maxInning}` : '';
    if (isBl) {
      return {
        playOrder: i + 1,
        gameIndex: ab.gameIndex,
        gameTitle: ab.gameTitle,
        batter: ab.batter,
        pitcher: ab.pitcher,
        pitchCount: ab.pitches?.length ?? 0,
        maxInning: ab.maxInning ?? null,
        reasonCode: 'borderline',
        reasonDetail: `Borderline called pitch within ${edgeFt} ft of the zone edge. Mix target ${borderlineTarget} borderline / ${normalTarget} standard (seed ${seed}).${capNote}${lateNote}${inning}`,
      };
    }
    return {
      playOrder: i + 1,
      gameIndex: ab.gameIndex,
      gameTitle: ab.gameTitle,
      batter: ab.batter,
      pitcher: ab.pitcher,
      pitchCount: ab.pitches?.length ?? 0,
      maxInning: ab.maxInning ?? null,
      reasonCode: 'standard',
      reasonDetail: `Standard AB: passed pitch filters, no borderline pitch in this at-bat (seed ${seed}).${capNote}${lateNote}${inning}`,
    };
  });

  return {
    selectedAtBats,
    playlistStats: {
      ...stats,
      borderlineTarget,
      normalTarget,
      shuffleSeed: seed,
      perGameCap: playlistOpts.perGameCap ?? null,
      prioritizeLateInning: !!playlistOpts.prioritizeLateInning,
    },
  };
}

/**
 * Stats for admin preview (no full playlist returned).
 */
export function summarizePlaylistBuild(games, meta, config) {
  const playlistOpts = resolvePlaylistOptions(meta, config);
  const edgeFt = playlistOpts.borderlineEdgeThresholdFt ?? 0.15;
  const candidates = groupGamesIntoAbs(games).filter((ab) =>
    abPassesFilters(ab, playlistOpts.filters || {}, playlistOpts)
  );
  let borderline = 0;
  let normal = 0;
  candidates.forEach((ab) => {
    if (abHasBorderlinePitch(ab, edgeFt)) borderline += 1;
    else normal += 1;
  });
  const playlist = buildWeeklyPlaylist(games, meta, config);
  return {
    candidateAbs: candidates.length,
    borderlinePool: borderline,
    normalPool: normal,
    selectedAbs: playlist.length,
    targetAtBats: playlistOpts.targetAtBats,
    borderlineRatio: playlistOpts.borderlineRatio,
  };
}
