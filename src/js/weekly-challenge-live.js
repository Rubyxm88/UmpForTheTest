/**
 * Hydrate bundled weekly challenge data from /api/weekly-challenge when Supabase has an assignment.
 */

export let activeWeeklyBundleId = null;

export async function hydrateWeeklyChallengeFromApi(dataArray, metaObject) {
  activeWeeklyBundleId = null;
  try {
    const res = await fetch('/api/weekly-challenge', { credentials: 'same-origin' });
    if (res.status === 503 || res.status === 404) {
      return { applied: false, status: res.status, source: 'bundle_fallback' };
    }
    if (!res.ok) {
      return { applied: false, status: res.status, source: 'error' };
    }
    const body = await res.json();
    if (!body?.games?.length || !body.meta) {
      return { applied: false, source: 'empty' };
    }

    dataArray.length = 0;
    for (const game of body.games) {
      dataArray.push(game);
    }
    for (const key of Object.keys(metaObject)) {
      delete metaObject[key];
    }
    Object.assign(metaObject, body.meta);

    activeWeeklyBundleId = body.bundleId || null;
    return {
      applied: true,
      bundleId: body.bundleId,
      weekId: body.weekId,
      label: body.label,
      source: body.source || 'supabase',
    };
  } catch (err) {
    console.warn('Weekly challenge live fetch failed; using bundled data.', err);
    return { applied: false, source: 'network', error: err?.message };
  }
}

/** @param {string} weekId @param {string|null} bundleId */
export function getStoredWeeklyRevisionKey(weekId, bundleId) {
  return `${weekId}:${bundleId || 'bundled'}`;
}

export function readStoredWeeklyRevision() {
  return localStorage.getItem('ump_weekly_bundle_revision') || '';
}

export function writeStoredWeeklyRevision(weekId, bundleId) {
  const key = getStoredWeeklyRevisionKey(weekId, bundleId);
  localStorage.setItem('ump_weekly_bundle_revision', key);
  localStorage.setItem('ump_weekly_challenge_week', weekId);
  return key;
}
