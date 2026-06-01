/**
 * Hydrate bundled weekly challenge data from /api/weekly-challenge when Supabase has an assignment.
 */

export let activeWeeklyBundleId = null;

let cachedWeeklyResponse = null;
let weeklyChallengePromise = null;

export function clearWeeklyChallengeCache() {
  cachedWeeklyResponse = null;
  weeklyChallengePromise = null;
}

export async function hydrateWeeklyChallengeFromApi(dataArray, metaObject) {
  if (cachedWeeklyResponse) {
    if (!cachedWeeklyResponse.result.applied) {
      return cachedWeeklyResponse.result;
    }
    dataArray.length = 0;
    for (const game of cachedWeeklyResponse.games) {
      dataArray.push(game);
    }
    for (const key of Object.keys(metaObject)) {
      delete metaObject[key];
    }
    Object.assign(metaObject, cachedWeeklyResponse.meta);
    if (cachedWeeklyResponse.weekId) {
      metaObject.challengeWeekId = cachedWeeklyResponse.weekId;
    }
    activeWeeklyBundleId = cachedWeeklyResponse.bundleId || null;
    return cachedWeeklyResponse.result;
  }

  if (weeklyChallengePromise) {
    await weeklyChallengePromise;
    return hydrateWeeklyChallengeFromApi(dataArray, metaObject);
  }

  weeklyChallengePromise = (async () => {
    activeWeeklyBundleId = null;
    try {
      const res = await fetch('/api/weekly-challenge', { credentials: 'same-origin' });
      if (res.status === 503 || res.status === 404) {
        const result = { applied: false, status: res.status, source: 'bundle_fallback' };
        cachedWeeklyResponse = { games: [], meta: {}, result };
        return result;
      }
      if (!res.ok) {
        return { applied: false, status: res.status, source: 'error' };
      }
      const body = await res.json();
      if (!body?.games?.length || !body.meta) {
        const result = { applied: false, source: 'empty' };
        cachedWeeklyResponse = { games: [], meta: {}, result };
        return result;
      }

      const result = {
        applied: true,
        bundleId: body.bundleId,
        weekId: body.weekId,
        label: body.label,
        source: body.source || 'supabase',
      };

      cachedWeeklyResponse = {
        games: body.games,
        meta: body.meta,
        weekId: body.weekId,
        bundleId: body.bundleId,
        label: body.label,
        source: body.source,
        result
      };

      dataArray.length = 0;
      for (const game of body.games) {
        dataArray.push(game);
      }
      for (const key of Object.keys(metaObject)) {
        delete metaObject[key];
      }
      Object.assign(metaObject, body.meta);
      if (body.weekId) {
        metaObject.challengeWeekId = body.weekId;
      }
      activeWeeklyBundleId = body.bundleId || null;

      return result;
    } catch (err) {
      console.warn('Weekly challenge live fetch failed; using bundled data.', err);
      return { applied: false, source: 'network', error: err?.message };
    } finally {
      weeklyChallengePromise = null;
    }
  })();

  return weeklyChallengePromise;
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
