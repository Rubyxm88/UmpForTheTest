export function getDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** ISO week key, e.g. 2026-W22 */
export function getIsoWeekKey(date = new Date()) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function resolvePeriodKey(board, periodKey) {
  if (periodKey) return periodKey;
  if (board === 'weekly') return getIsoWeekKey();
  if (board === 'daily') return getDateKey();
  if (board === 'alltime') return 'all';
  return null;
}
