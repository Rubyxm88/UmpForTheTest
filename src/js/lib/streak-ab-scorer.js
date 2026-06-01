/**
 * Streak Challenge AB eligibility + difficulty scoring.
 * Shared by pool builder, rotation generator, and client runtime.
 */

export const BORDERLINE_FT = 0.15;
export const PLATE_HALF_WIDTH = 1.4167 / 2;
export const BALL_RADIUS = 0.12;

const MIN_TAKEN_PITCHES = 1;
const MIN_TOTAL_PITCHES = 2;
const MAX_DAYS_BEFORE_REUSE = 7;

/** @typedef {{ eligible: boolean, rejectReason: string|null, difficulty: number, tier: number, metrics: object }} AbScore */

export function calculateCrossingPoint(pitch) {
  const PLATE_MIDPOINT_Z = 0.7083;
  const a = 0.5 * pitch.ay;
  const b = pitch.vy0;
  const c = pitch.release_pos_y - PLATE_MIDPOINT_Z;

  let t = 0;
  if (Math.abs(a) < 0.0001) {
    t = c / -b;
  } else {
    const discriminant = Math.pow(b, 2) - 4 * a * c;
    t = discriminant < 0 ? c / -b : (-b - Math.sqrt(discriminant)) / (2 * a);
  }

  return {
    x: -(pitch.release_pos_x + pitch.vx0 * t + 0.5 * pitch.ax * Math.pow(t, 2)),
    y: pitch.release_pos_z + pitch.vz0 * t + 0.5 * pitch.az * Math.pow(t, 2),
  };
}

export function edgeDistanceFt(pitch, cross) {
  const xEdgeDist = Math.abs(Math.abs(cross.x) - 0.8283);
  const yBotDist = Math.abs(cross.y - (pitch.sz_bot - 0.12));
  const yTopDist = Math.abs(cross.y - (pitch.sz_top + 0.12));
  const yEdgeDist = Math.min(yBotDist, yTopDist);
  return Math.min(xEdgeDist, yEdgeDist);
}

export function isBorderlinePitch(pitch) {
  if (pitch.is_swing || pitch.isSwingPlay) return false;
  if (pitch.vx0 == null || pitch.ay == null) return false;
  const cross = calculateCrossingPoint(pitch);
  return edgeDistanceFt(pitch, cross) <= BORDERLINE_FT;
}

/**
 * Score an at-bat for streak pool eligibility and difficulty (0–100, higher = harder).
 * @param {object} ab - { pitches, pitcher, batter, gamePk?, atBatNumber? }
 * @returns {AbScore}
 */
export function scoreStreakAtBat(ab) {
  const pitches = ab?.pitches || [];
  if (pitches.length === 0) {
    return reject('empty_ab');
  }

  if (pitches[0].is_swing || pitches[0].isSwingPlay) {
    return reject('first_pitch_swing');
  }

  if (pitches.every((p) => p.is_swing || p.isSwingPlay)) {
    return reject('all_swings');
  }

  if (pitches.length < MIN_TOTAL_PITCHES) {
    return reject('too_few_pitches');
  }

  const taken = pitches.filter((p) => !p.is_swing && !p.isSwingPlay);
  if (taken.length < MIN_TAKEN_PITCHES) {
    return reject('no_taken_pitches');
  }

  if (pitches.length === 1 && (pitches[0].is_swing || pitches[0].isSwingPlay)) {
    return reject('one_pitch_out');
  }

  let minEdge = Infinity;
  let borderlineCount = 0;
  let criticalCount = 0;

  for (const p of taken) {
    if (p.vx0 == null || p.ay == null) continue;
    const cross = calculateCrossingPoint(p);
    const edge = edgeDistanceFt(p, cross);
    minEdge = Math.min(minEdge, edge);
    if (edge <= BORDERLINE_FT) borderlineCount++;
    if (p.is_critical || (p.abs_call && p.real_ump_call && p.abs_call !== p.real_ump_call)) {
      criticalCount++;
    }
  }

  if (borderlineCount === 0) {
    return reject('no_borderline_taken');
  }

  if (!Number.isFinite(minEdge)) {
    return reject('missing_physics');
  }

  const edgeScore = Math.max(0, Math.min(100, 100 - (minEdge / BORDERLINE_FT) * 60));
  const borderlineBonus = Math.min(20, borderlineCount * 6);
  const lengthBonus = Math.min(10, (pitches.length - 2) * 2);
  const criticalBonus = Math.min(10, criticalCount * 5);

  const difficulty = Math.round(Math.min(100, edgeScore * 0.7 + borderlineBonus + lengthBonus + criticalBonus));
  const tier = Math.min(5, Math.max(1, Math.ceil(difficulty / 20)));

  return {
    eligible: true,
    rejectReason: null,
    difficulty,
    tier,
    metrics: {
      pitchCount: pitches.length,
      takenCount: taken.length,
      borderlineCount,
      criticalCount,
      minEdgeFt: Math.round(minEdge * 1000) / 1000,
    },
  };
}

function reject(reason) {
  return {
    eligible: false,
    rejectReason: reason,
    difficulty: 0,
    tier: 0,
    metrics: {},
  };
}

/** Target difficulty for streak position (trends up with oscillation). */
export function targetDifficultyForStreakIndex(streakIndex) {
  const i = Math.max(0, streakIndex);
  const progressive = 15 + 75 * (1 - Math.exp(-i / 45));
  const oscillation = 8 * Math.sin(i / 4.5);
  return Math.max(5, Math.min(98, progressive + oscillation));
}

export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function dateToSeed(dateKey) {
  const digits = String(dateKey || '').replace(/\D/g, '');
  const parsed = parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20260101;
}

export function pickStreakAbFromPool(pool, streakIndex, sessionUsedIds, dateKey, opts = {}) {
  const maxDaysBeforeReuse = opts.maxDaysBeforeReuse ?? MAX_DAYS_BEFORE_REUSE;
  const runSeed = opts.runSeed ?? dateToSeed(dateKey);
  const daySeenIds = opts.daySeenIds ?? null;
  const rng = mulberry32(runSeed + streakIndex * 9973);
  const target = targetDifficultyForStreakIndex(streakIndex);

  const cutoff = new Date(dateKey);
  cutoff.setDate(cutoff.getDate() - maxDaysBeforeReuse);

  const candidates = pool.filter((ab) => {
    if (!ab.eligible) return false;
    if (sessionUsedIds.has(ab.id)) return false;
    if (ab.lastUsedDate) {
      const last = new Date(ab.lastUsedDate);
      if (last >= cutoff) return false;
    }
    return true;
  });

  let poolSlice = candidates.length ? candidates : pool.filter((ab) => ab.eligible && !sessionUsedIds.has(ab.id));
  if (!poolSlice.length) {
    return null;
  }

  if (daySeenIds?.size) {
    const fresh = poolSlice.filter((ab) => !daySeenIds.has(ab.id));
    if (fresh.length >= Math.min(5, poolSlice.length)) {
      poolSlice = fresh;
    }
  }

  const sortByDifficulty = (a, b) => {
    const da = Math.abs(a.difficulty - target);
    const db = Math.abs(b.difficulty - target);
    if (da !== db) return da - db;
    return rng() - 0.5;
  };

  poolSlice.sort(sortByDifficulty);

  const topN = poolSlice.slice(0, Math.min(5, poolSlice.length));
  const idx = Math.floor(rng() * topN.length);
  return topN[idx];
}

export { MAX_DAYS_BEFORE_REUSE };
