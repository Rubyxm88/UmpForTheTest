/**
 * Client-side streak AB selection from curated pool + daily rotation.
 */

import { STREAK_POOL_META, STREAK_POOL_ABS } from '../data/streak_pool.js';
import { STREAK_ROTATION_META } from '../data/streak_rotation.js';
import {
  pickStreakAbFromPool,
  targetDifficultyForStreakIndex,
} from './lib/streak-ab-scorer.js';

export { STREAK_POOL_META, STREAK_ROTATION_META, targetDifficultyForStreakIndex };

/** @returns {string} YYYY-MM-DD */
export function getStreakDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function getStreakPool() {
  return STREAK_POOL_ABS.filter((ab) => ab.eligible);
}

export function getAbById(id) {
  return STREAK_POOL_ABS.find((ab) => ab.id === id) || null;
}

/**
 * Pick next AB for streak run.
 * @param {number} streakCorrectCount - correct called pitches so far this run
 * @param {Set<string>} sessionUsedIds
 * @param {string} [dateKey]
 */
/** Deterministic per-run seed — same inputs = same order, different attempt = different order. */
export function streakRunSeed(dateKey, username, attemptNo) {
  const raw = `${dateKey}|${(username || 'guest').toUpperCase()}|${attemptNo}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickNextStreakAb(streakCorrectCount, sessionUsedIds, dateKey = getStreakDateKey(), opts = {}) {
  const pool = getStreakPool();
  if (!pool.length) return null;

  const meta = STREAK_ROTATION_META;
  const useDate = meta?.rotationDate === dateKey ? dateKey : dateKey;
  const runSeed = opts.runSeed ?? dateToSeed(useDate);
  const daySeenIds = opts.daySeenIds ?? null;

  const picked = pickStreakAbFromPool(pool, streakCorrectCount, sessionUsedIds, useDate, {
    maxDaysBeforeReuse: meta?.maxDaysBeforeReuse ?? 7,
    runSeed,
    daySeenIds,
  });

  if (picked?.pitches?.length) return picked;

  // Fallback: resolve from daily order if manifest-only entries
  if (meta?.dailyOrder?.length) {
    const rngIdx = (streakCorrectCount + dateToSlot(dateKey)) % meta.dailyOrder.length;
    for (let offset = 0; offset < meta.dailyOrder.length; offset++) {
      const id = meta.dailyOrder[(rngIdx + offset) % meta.dailyOrder.length];
      if (sessionUsedIds.has(id)) continue;
      const ab = getAbById(id);
      if (ab?.pitches?.length) return ab;
    }
  }

  return picked;
}

function dateToSlot(dateKey) {
  return parseInt(String(dateKey).replace(/\D/g, ''), 10) % 10000;
}

/**
 * Build initial session playlist (lazy — picks on demand via pickNextStreakAb).
 */
export function initStreakSessionUsedIds() {
  return new Set();
}

export function streakCorrectCount(streakPitchHistory) {
  const called = (streakPitchHistory || []).filter((x) => !x.isSwingPlay);
  return called.filter((x) => x.userCorrect).length;
}

export function isRotationStale(dateKey = getStreakDateKey()) {
  return STREAK_ROTATION_META?.rotationDate !== dateKey;
}
