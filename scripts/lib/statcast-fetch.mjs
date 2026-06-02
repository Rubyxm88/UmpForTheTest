/**
 * Server-side fetch of baseball-savant Statcast "type=details" CSV.
 *
 * Mirrors the battle-tested pybaseball URL contract. Fetches by date range,
 * chunking into per-day requests to stay under Savant's ~25k-row response cap
 * and to keep individual requests fast (serverless-friendly).
 */

const SAVANT_BASE = 'https://baseballsavant.mlb.com/statcast_search/csv';

/** Build the Savant CSV URL for a single date range. */
export function buildSavantCsvUrl({ startDt, endDt, team = '' }) {
  const params =
    'all=true&hfPT=&hfAB=&hfBBT=&hfPR=&hfZ=&stadium=&hfBBL=&hfNewZones=' +
    '&hfGT=R%7CPO%7CS%7C=&hfSea=&hfSit=&player_type=pitcher&hfOuts=&opponent=' +
    '&pitcher_throws=&batter_stands=&hfSA=' +
    `&game_date_gt=${encodeURIComponent(startDt)}&game_date_lt=${encodeURIComponent(endDt)}` +
    `&team=${encodeURIComponent(team)}&position=&hfRO=&home_road=&hfFlag=&metric_1=&hfInn=` +
    '&min_pitches=0&min_results=0&group_by=name&sort_col=pitches' +
    '&player_event_sort=h_launch_speed&sort_order=desc&min_abs=0&type=details&';
  return `${SAVANT_BASE}?${params}`;
}

/** YYYY-MM-DD for a Date (UTC). */
function fmt(d) {
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD strings between start and end. */
export function eachDay(startDt, endDt) {
  const days = [];
  const start = new Date(`${startDt}T00:00:00Z`);
  const end = new Date(`${endDt}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(fmt(d));
  }
  return days;
}

/** Fetch one date range's CSV text. Throws on HTTP error. */
export async function fetchSavantCsvRange({ startDt, endDt, team = '', timeoutMs = 30000 }) {
  const url = buildSavantCsvUrl({ startDt, endDt, team });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'UmpSim3000/1.0 (+streak-pool-ingest)' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Savant responded ${res.status} for ${startDt}..${endDt}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a date range, chunked per day. Returns merged CSV text (single header)
 * plus per-day fetch diagnostics.
 *
 * @param {object} opts - { startDt, endDt, team, maxDays, onProgress }
 * @returns {{ csv: string, days: Array<{date,rows,ok,error?}>, headerLine: string }}
 */
export async function fetchStatcastCsv({ startDt, endDt, team = '', maxDays = 14, onProgress } = {}) {
  const days = eachDay(startDt, endDt);
  if (days.length > maxDays) {
    throw new Error(`Range too large: ${days.length} days (max ${maxDays}). Narrow the dates.`);
  }

  let headerLine = '';
  const bodyLines = [];
  const diagnostics = [];

  for (const day of days) {
    try {
      const text = await fetchSavantCsvRange({ startDt: day, endDt: day, team });
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      if (lines.length === 0) {
        diagnostics.push({ date: day, rows: 0, ok: true });
      } else {
        if (!headerLine) headerLine = lines[0];
        const rows = lines.slice(1);
        bodyLines.push(...rows);
        diagnostics.push({ date: day, rows: rows.length, ok: true });
      }
    } catch (err) {
      diagnostics.push({ date: day, rows: 0, ok: false, error: err.message });
    }
    if (typeof onProgress === 'function') {
      onProgress({ date: day, done: diagnostics.length, total: days.length });
    }
  }

  const csv = headerLine ? [headerLine, ...bodyLines].join('\n') : '';
  return { csv, days: diagnostics, headerLine };
}
