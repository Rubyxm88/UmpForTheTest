import { hashPIN, isValidHandle, isValidPin } from '../_lib/pin.js';
import {
  normalizeHandle,
  readJsonBody,
  sendJson,
  setSessionCookie,
} from '../_lib/http.js';
import { createSessionToken } from '../_lib/session.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

const BLANK_STATS = {
  xp: 0,
  overallAccuracy: null,
  maxStreak: 0,
  completedWeekly: 0,
  dnfs: 0,
  favoriteTeam: 'none',
  history: [],
  dailyHistory: {},
  teamStats: {},
};

export default async function handler(req, res) {
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
    const { data: existing } = await supabase
      .from('profiles')
      .select('handle')
      .eq('handle', handle)
      .maybeSingle();

    if (existing) {
      sendJson(res, 409, { error: 'Handle already registered' });
      return;
    }

    const pinHash = hashPIN(pin);
    const { error: profileError } = await supabase.from('profiles').insert({
      handle,
      pin_hash: pinHash,
      favorite_team: 'none',
    });

    if (profileError) {
      sendJson(res, 500, { error: profileError.message });
      return;
    }

    const { error: statsError } = await supabase.from('user_stats').insert({
      handle,
      xp: 0,
      overall_accuracy: null,
      max_streak: 0,
      completed_weekly: 0,
      dnfs: 0,
      stats_json: {
        history: [],
        dailyHistory: {},
        teamStats: {},
        favoriteTeam: 'none',
      },
    });

    if (statsError) {
      sendJson(res, 500, { error: statsError.message });
      return;
    }

    const token = createSessionToken(handle);
    setSessionCookie(res, token);

    sendJson(res, 201, {
      handle,
      favoriteTeam: 'none',
      stats: BLANK_STATS,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Registration failed' });
  }
}
