import {
  weeklyProgressQualifiesForLeaderboardSubmit,
} from '../../src/js/challenge-utils.js';

export function challengeProgressFromStatsRow(statsRow) {
  const json = statsRow?.stats_json;
  if (!json || typeof json !== 'object') return null;
  return json.challengeProgress || null;
}

export function isEligibleForWeeklyLeaderboardSubmit(statsRow, periodKey) {
  const progress = challengeProgressFromStatsRow(statsRow);
  return weeklyProgressQualifiesForLeaderboardSubmit(progress, periodKey);
}
