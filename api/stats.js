import { getHandleFromRequest } from './_lib/session.js';
import { readJsonBody, sendJson } from './_lib/http.js';
import {
  getSupabaseAdmin,
  rowToClientStats,
  clientStatsToRow,
} from './_lib/supabase.js';

export default async function handler(req, res) {
  const handle = getHandleFromRequest(req);
  if (!handle) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  const supabase = getSupabaseAdmin();

  if (req.method === 'GET') {
    try {
      const { data: row, error } = await supabase
        .from('user_stats')
        .select('*')
        .eq('handle', handle)
        .maybeSingle();

      if (error) {
        sendJson(res, 500, { error: error.message });
        return;
      }

      sendJson(res, 200, { stats: rowToClientStats(row) });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Failed to load stats' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const body = await readJsonBody(req);
      const stats = body.stats;
      if (!stats || typeof stats !== 'object') {
        sendJson(res, 400, { error: 'Missing stats object' });
        return;
      }

      const row = clientStatsToRow(handle, stats);
      const favoriteTeam = stats.favoriteTeam || 'none';

      const { error: statsError } = await supabase
        .from('user_stats')
        .upsert(row, { onConflict: 'handle' });

      if (statsError) {
        sendJson(res, 500, { error: statsError.message });
        return;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ favorite_team: favoriteTeam })
        .eq('handle', handle);

      if (profileError) {
        sendJson(res, 500, { error: profileError.message });
        return;
      }

      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Failed to save stats' });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}
