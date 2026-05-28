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

export async function apiRegister(handle, pin) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...API_FETCH_OPTS,
    body: JSON.stringify({ handle, pin }),
  });
  return parseResponse(res);
}

export async function apiLogin(handle, pin) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...API_FETCH_OPTS,
    body: JSON.stringify({ handle, pin }),
  });
  return parseResponse(res);
}

export async function apiUpdatePin(pin) {
  const res = await fetch('/api/auth/pin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    ...API_FETCH_OPTS,
    body: JSON.stringify({ pin }),
  });
  return parseResponse(res);
}

export async function apiLogout() {
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    ...API_FETCH_OPTS,
  });
  return parseResponse(res);
}

export async function apiMe() {
  const res = await fetch('/api/auth/me', { ...API_FETCH_OPTS });
  return parseResponse(res);
}

export async function apiSaveStats(stats) {
  const res = await fetch('/api/stats', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    ...API_FETCH_OPTS,
    body: JSON.stringify({ stats }),
  });
  return parseResponse(res);
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
