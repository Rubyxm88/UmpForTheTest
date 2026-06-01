import { getHandleFromRequest } from '../../_lib/session.js';
import { sendJson } from '../../_lib/http.js';
import { getSupabaseAdmin, rowToClientStats } from '../../_lib/supabase.js';

export async function handleMe(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const handle = getHandleFromRequest(req);
    if (!handle) {
      sendJson(res, 401, { error: 'Not authenticated' });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('handle, favorite_team')
      .eq('handle', handle)
      .maybeSingle();

    if (profileError) {
      sendJson(res, 500, { error: profileError.message });
      return;
    }
    if (!profile) {
      sendJson(res, 404, { error: 'Profile not found' });
      return;
    }

    const { data: statsRow, error: statsError } = await supabase
      .from('user_stats')
      .select('*')
      .eq('handle', handle)
      .maybeSingle();

    if (statsError) {
      sendJson(res, 500, { error: statsError.message });
      return;
    }

    sendJson(res, 200, {
      handle,
      favoriteTeam: profile.favorite_team || 'none',
      stats: rowToClientStats(statsRow),
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Session check failed' });
  }
}
