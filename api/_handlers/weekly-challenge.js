/**
 * GET /api/weekly-challenge — live weekly bundle for players (current ISO week by default).
 * Falls back to bundled src/data/weekly_challenge.js when no assignment exists in storage.
 */

import { sendJson } from '../_lib/http.js';
import { getIsoWeekKey } from '../_lib/period.js';
import { isSupabaseConfigured } from '../_lib/supabase.js';
import { getAssignedWeeklyBundle } from '../../scripts/lib/weekly-live.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const weekId = url.searchParams.get('week') || getIsoWeekKey();

    if (!isSupabaseConfigured()) {
      sendJson(res, 503, {
        error: 'Live weekly storage not configured',
        weekId,
        source: 'bundle_fallback',
      });
      return;
    }

    const assigned = await getAssignedWeeklyBundle(weekId);
    if (!assigned) {
      sendJson(res, 404, {
        error: `No weekly challenge assigned for ${weekId}`,
        weekId,
        source: 'bundle_fallback',
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      weekId: assigned.weekId,
      bundleId: assigned.bundleId,
      label: assigned.label,
      meta: assigned.meta,
      games: assigned.games,
      assignedAt: assigned.assignedAt,
      updatedAt: assigned.updatedAt,
      storage: assigned.storage,
      source: 'supabase',
    });
  } catch (err) {
    console.error('weekly-challenge:', err);
    sendJson(res, 500, { error: err.message || 'Failed to load weekly challenge' });
  }
}
