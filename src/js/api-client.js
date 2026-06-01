/**
 * UmpSim API client — talks to Vercel /api routes (Supabase backend).
 * Uses cookie sessions (credentials: 'include').
 */

const API_FETCH_OPTS = { credentials: 'include' };

async function parseResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let meCache = null;
let mePromise = null;

export function clearMeCache() {
  meCache = null;
  mePromise = null;
}

export async function apiRegister(handle, pin) {
  clearMeCache();
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...API_FETCH_OPTS,
    body: JSON.stringify({ handle, pin }),
  });
  return parseResponse(res);
}

export async function apiLogin(handle, pin) {
  clearMeCache();
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...API_FETCH_OPTS,
    body: JSON.stringify({ handle, pin }),
  });
  return parseResponse(res);
}

export async function apiUpdatePin(pin) {
  clearMeCache();
  const res = await fetch('/api/auth/pin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    ...API_FETCH_OPTS,
    body: JSON.stringify({ pin }),
  });
  return parseResponse(res);
}

export async function apiLogout() {
  clearMeCache();
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    ...API_FETCH_OPTS,
  });
  return parseResponse(res);
}

export async function apiMe() {
  if (meCache) return meCache;
  if (mePromise) return mePromise;

  mePromise = (async () => {
    try {
      const res = await fetch('/api/auth/me', { ...API_FETCH_OPTS });
      const data = await parseResponse(res);
      meCache = data;
      return data;
    } catch (err) {
      mePromise = null;
      throw err;
    } finally {
      mePromise = null;
    }
  })();
  return mePromise;
}

export async function apiSaveStats(stats) {
  const res = await fetch('/api/stats', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    ...API_FETCH_OPTS,
    body: JSON.stringify({ stats }),
  });
  const data = await parseResponse(res);
  if (meCache) {
    meCache.stats = stats;
  }
  return data;
}

export async function apiFetchLeaderboardPeriods(board) {
  const params = new URLSearchParams({ board });
  params.set('view', 'periods');
  const res = await fetch(`/api/leaderboard?${params}`, { ...API_FETCH_OPTS });
  const data = await parseResponse(res);
  return {
    periods: data.periods || [],
    source: data.source === 'live' ? 'live' : data.periods?.length ? 'live' : 'empty',
  };
}

export async function apiFetchCrewLeaderboard(metric, username) {
  const params = new URLSearchParams({ metric, username: username || '' });
  params.set('view', 'crew');
  const res = await fetch(`/api/leaderboard?${params}`, { ...API_FETCH_OPTS });
  const data = await parseResponse(res);
  return {
    rows: data.rows || [],
    source: data.source === 'live' ? 'live' : data.rows?.length ? 'live' : 'empty',
    metric: data.metric,
  };
}

export async function apiFetchLeaderboard(board, username, period) {
  const params = new URLSearchParams({ board, username: username || '' });
  if (period) params.set('period', period);
  const res = await fetch(`/api/leaderboard?${params}`, { ...API_FETCH_OPTS });
  const data = await parseResponse(res);
  return {
    rows: data.rows || [],
    source: data.source === 'live' ? 'live' : data.rows?.length ? 'live' : 'empty',
    periodKey: data.periodKey,
  };
}

export async function apiSubmitLeaderboard({
  board,
  periodKey,
  team,
  accuracy,
  scoreText,
  scoreRaw,
}) {
  const res = await fetch('/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...API_FETCH_OPTS,
    body: JSON.stringify({
      board,
      periodKey,
      team,
      accuracy,
      scoreText,
      scoreRaw,
    }),
  });
  return parseResponse(res);
}

/** True when API is reachable (same-origin / proxied). */
export async function isApiAvailable() {
  try {
    const res = await fetch('/api/auth/me', { ...API_FETCH_OPTS });
    return res.status === 200 || res.status === 401;
  } catch {
    return false;
  }
}
