import { sendJson } from '../_lib/http.js';
import { getAdminFromRequest } from '../_lib/admin-session.js';
import { tryGetSupabaseAdmin, SUPABASE_SETUP_HINT } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!getAdminFromRequest(req)) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  const supabase = tryGetSupabaseAdmin();
  if (!supabase) {
    sendJson(res, 200, {
      users: [],
      count: 0,
      supabaseConfigured: false,
      setupHint: SUPABASE_SETUP_HINT,
    });
    return;
  }

  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('handle, favorite_team, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      sendJson(res, 500, { error: error.message });
      return;
    }

    const handles = (profiles || []).map((p) => p.handle);
    let statsMap = {};
    if (handles.length) {
      const { data: statsRows } = await supabase
        .from('user_stats')
        .select('handle, xp, overall_accuracy, max_streak, completed_weekly, dnfs, updated_at')
        .in('handle', handles);
      statsMap = Object.fromEntries((statsRows || []).map((s) => [s.handle, s]));
    }

    const users = (profiles || []).map((p) => ({
      handle: p.handle,
      favoriteTeam: p.favorite_team,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      stats: statsMap[p.handle] || null,
    }));

    sendJson(res, 200, { users, count: users.length });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Failed to list users' });
  }
}
