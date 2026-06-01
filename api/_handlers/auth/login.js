import { hashPIN, isValidHandle, isValidPin } from '../../_lib/pin.js';
import {
  normalizeHandle,
  readJsonBody,
  sendJson,
  setSessionCookie,
} from '../../_lib/http.js';
import { createSessionToken } from '../../_lib/session.js';
import { getSupabaseAdmin, rowToClientStats } from '../../_lib/supabase.js';

export async function handleLogin(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const handle = normalizeHandle(body.handle);
    const pin = String(body.pin || '');

    if (!isValidHandle(handle)) {
      sendJson(res, 400, { error: 'Handle must be at least 3 characters' });
      return;
    }
    if (!isValidPin(pin)) {
      sendJson(res, 400, { error: 'PIN must be 4 to 8 digits' });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('handle, pin_hash, favorite_team')
      .eq('handle', handle)
      .maybeSingle();

    if (profileError) {
      sendJson(res, 500, { error: profileError.message });
      return;
    }
    if (!profile) {
      sendJson(res, 404, { error: 'Handle not found' });
      return;
    }

    if (profile.pin_hash !== hashPIN(pin)) {
      sendJson(res, 401, { error: 'Invalid PIN' });
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

    const token = createSessionToken(handle);
    setSessionCookie(res, token);

    sendJson(res, 200, {
      handle,
      favoriteTeam: profile.favorite_team || 'none',
      stats: rowToClientStats(statsRow) || {
        xp: 0,
        overallAccuracy: null,
        maxStreak: 0,
        completedWeekly: 0,
        dnfs: 0,
        favoriteTeam: profile.favorite_team || 'none',
        history: [],
        dailyHistory: {},
        teamStats: {},
      },
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Login failed' });
  }
}
