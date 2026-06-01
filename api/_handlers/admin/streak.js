import { sendJson } from '../../_lib/http.js';
import { getAdminFromRequest } from '../../_lib/admin-session.js';
import { tryGetSupabaseAdmin, SUPABASE_SETUP_HINT } from '../../_lib/supabase.js';
import {
  fetchStreakAdminDashboard,
  listStreakAbsForAdmin,
  listStreakSessionsForAdmin,
} from '../../../scripts/lib/streak-analytics.mjs';
import { getStreakPoolMeta } from '../../../scripts/lib/streak-pool-meta.mjs';

export default async function handler(req, res) {
  if (!getAdminFromRequest(req)) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  const supabase = tryGetSupabaseAdmin();
  if (!supabase) {
    sendJson(res, 200, {
      ok: true,
      supabaseConfigured: false,
      setupHint: SUPABASE_SETUP_HINT,
      bundleMeta: getStreakPoolMeta(),
      readiness: { phase: 'bundle_only' },
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const view = url.searchParams.get('view') || 'dashboard';

      if (view === 'abs') {
        const data = await listStreakAbsForAdmin({
          page: Number(url.searchParams.get('page') || 1),
          limit: Math.min(100, Number(url.searchParams.get('limit') || 50)),
          search: url.searchParams.get('search') || '',
          sort: url.searchParams.get('sort') || 'times_served',
        });
        sendJson(res, 200, { ok: true, ...data });
        return;
      }

      if (view === 'sessions') {
        const data = await listStreakSessionsForAdmin({
          page: Number(url.searchParams.get('page') || 1),
          limit: Math.min(100, Number(url.searchParams.get('limit') || 30)),
          handle: url.searchParams.get('handle') || '',
        });
        sendJson(res, 200, { ok: true, ...data });
        return;
      }

      const dash = await fetchStreakAdminDashboard();
      sendJson(res, 200, {
        ok: true,
        supabaseConfigured: true,
        bundleMeta: getStreakPoolMeta(),
        readiness: {
          phase:
            dash.poolCount >= 1000
              ? 'supabase_pool'
              : dash.poolCount > 0
                ? 'partial_ingest'
                : 'bundle_only',
          ready20k: dash.ready20k,
          steps: [
            {
              id: 'migration_pool',
              label: 'streak_at_bats tables',
              done: dash.tables.streak_at_bats,
            },
            {
              id: 'migration_analytics',
              label: 'streak_sessions + streak_ab_stats',
              done: dash.tables.streak_ab_stats && dash.tables.streak_sessions,
            },
            {
              id: 'ingest',
              label: 'Bulk ingest 20k+ ABs (npm run streak-pool:ingest)',
              done: dash.poolCount >= 1000,
              detail: `${dash.poolCount} rows in DB`,
            },
            {
              id: 'client_api',
              label: 'Client loads ABs from /api/streak-pool (not bundle)',
              done: false,
              detail: `Bundle has ${getStreakPoolMeta().totalAbs} ABs shipped in build`,
            },
            {
              id: 'telemetry',
              label: 'Play events recorded to Supabase',
              done: dash.sessionCount > 0 || dash.statsRowCount > 0,
              detail: `${dash.sessionCount} sessions, ${dash.statsRowCount} AB stat rows`,
            },
          ],
        },
        ...dash,
      });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('admin/streak:', err);
    sendJson(res, 500, { error: err.message || 'Streak admin failed' });
  }
}
