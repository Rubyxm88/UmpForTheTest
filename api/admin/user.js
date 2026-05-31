import { normalizeHandle, readJsonBody, sendJson } from '../_lib/http.js';
import { getAdminFromRequest } from '../_lib/admin-session.js';
import {
  tryGetSupabaseAdmin,
  rowToClientStats,
  SUPABASE_SETUP_HINT,
} from '../_lib/supabase.js';

export default async function handler(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const handle = normalizeHandle(url.searchParams.get('handle') || '');

  if (!handle || handle.length < 3) {
    sendJson(res, 400, { error: 'Valid handle required' });
    return;
  }

  const supabase = tryGetSupabaseAdmin();
  if (!supabase) {
    sendJson(res, 503, { error: SUPABASE_SETUP_HINT, supabaseConfigured: false });
    return;
  }

  if (req.method === 'GET') {
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('handle', handle)
        .maybeSingle();

      if (profileError) {
        sendJson(res, 500, { error: profileError.message });
        return;
      }
      if (!profile) {
        sendJson(res, 404, { error: 'User not found' });
        return;
      }

      const { data: statsRow } = await supabase
        .from('user_stats')
        .select('*')
        .eq('handle', handle)
        .maybeSingle();

      const { data: leaderboardRows } = await supabase
        .from('leaderboard_entries')
        .select('board, period_key, score_raw, score_text, accuracy, submitted_at')
        .eq('handle', handle)
        .order('submitted_at', { ascending: false })
        .limit(30);

      sendJson(res, 200, {
        profile: {
          handle: profile.handle,
          favoriteTeam: profile.favorite_team,
          createdAt: profile.created_at,
          updatedAt: profile.updated_at,
        },
        stats: rowToClientStats(statsRow),
        leaderboardEntries: leaderboardRows || [],
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Failed to load user' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      const body = await readJsonBody(req);
      if (body.confirmHandle !== handle) {
        sendJson(res, 400, { error: 'confirmHandle must match handle' });
        return;
      }

      const { error } = await supabase.from('profiles').delete().eq('handle', handle);
      if (error) {
        sendJson(res, 500, { error: error.message });
        return;
      }

      sendJson(res, 200, { ok: true, deleted: handle });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Delete failed' });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}
