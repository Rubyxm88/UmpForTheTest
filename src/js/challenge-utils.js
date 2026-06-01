/** Shared challenge period + weekly metadata helpers */

export function getIsoWeekKey(date = new Date()) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function getPreviousIsoWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setDate(d.getDate() - 7);
  return getIsoWeekKey(d);
}

export function getMondayDateString(d = new Date()) {
  const day = d.getDay();
  const diff = d.getDate() - (day === 0 ? 6 : day - 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().slice(0, 10);
}

export function isoWeekToShuffleSeed(weekId) {
  const digits = String(weekId || '').replace(/\D/g, '');
  const parsed = parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20260101;
}

export function extractGamePkFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/game\/(\d+)/) || String(url).match(/game_id=(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Leaderboard period for the active weekly challenge.
 * Uses the calendar ISO week when the bundled reset Monday is before this week's Monday
 * so scores still land on the current board before a new bundle is deployed.
 */
export function getWeeklyLeaderboardPeriodKey(challengeWeekId, resetDate) {
  const calendarWeekId = getIsoWeekKey();
  if (!challengeWeekId) return calendarWeekId;
  if (!resetDate) return challengeWeekId;
  if (resetDate < getMondayDateString() && challengeWeekId !== calendarWeekId) {
    return calendarWeekId;
  }
  return challengeWeekId;
}

export function resolveWeeklyChallengeMeta(data, exportedMeta) {
  if (exportedMeta && exportedMeta.challengeWeekId) {
    return {
      challengeWeekId: exportedMeta.challengeWeekId,
      resetDate: exportedMeta.resetDate || getMondayDateString(),
      gameCount: exportedMeta.gameCount ?? data.length,
      targetAtBats: exportedMeta.targetAtBats ?? 20,
      gamePks: exportedMeta.gamePks || data.map((g) => g.gamePk || extractGamePkFromUrl(g.film_room_url)).filter(Boolean),
      shuffleSeed: exportedMeta.shuffleSeed ?? isoWeekToShuffleSeed(exportedMeta.challengeWeekId),
    };
  }

  const weekId = getIsoWeekKey();
  return {
    challengeWeekId: weekId,
    resetDate: getMondayDateString(),
    gameCount: data.length,
    targetAtBats: 20,
    gamePks: data.map((g) => g.gamePk || extractGamePkFromUrl(g.film_room_url)).filter(Boolean),
    shuffleSeed: isoWeekToShuffleSeed(weekId),
  };
}

export function formatWeekLabel(weekId) {
  return weekId ? weekId.replace('-W', ' · Week ') : 'Current Week';
}

/** Recent ISO week keys, newest first (includes anchor week). */
export function listRecentIsoWeekKeys(count = 16, anchorDate = new Date()) {
  const weeks = [];
  const d = new Date(anchorDate);
  for (let i = 0; i < count; i++) {
    weeks.push(getIsoWeekKey(d));
    d.setDate(d.getDate() - 7);
  }
  return weeks;
}

export function formatWeekSelectLabel(weekId, currentWeekId) {
  if (!weekId) return 'Select week';
  if (weekId === currentWeekId) return `${weekId} (current)`;
  return weekId;
}

/** Count playlist slots marked complete (client sets `completed` when an AB is fully umpired). */
export function countWeeklyCompletedAbs(playlist) {
  if (!Array.isArray(playlist)) return 0;
  return playlist.filter((ab) => ab?.completed).length;
}

export function getWeeklyTargetFromProgress(progress, fallback = 20) {
  const configured = Number(progress?.weeklyTargetAtBats);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const len = progress?.weeklyPlaylistABs?.length;
  if (len > 0) return len;
  return fallback;
}

/** True when saved/in-flight weekly progress qualifies for official leaderboard submission. */
export function isWeeklyProgressCompleteForLeaderboard(progress, targetAtBats = null) {
  if (!progress) return false;
  if (progress.weeklyRunComplete === true) return true;
  const target = targetAtBats ?? getWeeklyTargetFromProgress(progress);
  return countWeeklyCompletedAbs(progress.weeklyPlaylistABs) >= target;
}

export function challengeProgressMatchesLeaderboardPeriod(progress, periodKey) {
  if (!periodKey || !progress?.weeklyChallengeWeekId) return true;
  return progress.weeklyChallengeWeekId === periodKey;
}

export function weeklyProgressQualifiesForLeaderboardSubmit(progress, periodKey) {
  if (!isWeeklyProgressCompleteForLeaderboard(progress)) return false;
  return challengeProgressMatchesLeaderboardPeriod(progress, periodKey);
}
