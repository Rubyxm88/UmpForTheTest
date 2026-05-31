import { normalizeHandle, sendJson } from './_lib/http.js';
import { getSupabaseAdmin } from './_lib/supabase.js';

const METRICS = new Set(['rank', 'wins', 'streak']);

function mapCrewRows(list, username, metric) {
  const normalizedUser = normalizeHandle(username);
  const sorted = [...list].sort((a, b) => {
    if (metric === 'rank') return (b.xp || 0) - (a.xp || 0);
    if (metric === 'wins') return (b.completed_weekly || 0) - (a.completed_weekly || 0);
    return (b.max_streak || 0) - (a.max_streak || 0);
  });

  return sorted.slice(0, 50).map((item, idx) => {
    const isUser = normalizeHandle(item.handle) === normalizedUser;
    const xp = item.xp || 0;
    const level = Math.floor(xp / 1000) + 1;
    const avgAcc =
      item.overall_accuracy != null ? `${item.overall_accuracy}%` : '--';

    let scoreText = `${level}`;
    let accuracyText = `${xp.toLocaleString()} XP`;

    if (metric === 'wins') {
      scoreText = `${item.completed_weekly || 0}`;
      accuracyText = avgAcc;
    } else if (metric === 'streak') {
      scoreText = `${item.max_streak || 0}`;
      accuracyText = avgAcc;
    }

    let team = 'none';
    if (item.profiles) {
      const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
      team = profile?.favorite_team || 'none';
    }

    return {
      rank: idx + 1,
      name: isUser ? `${normalizedUser} (YOU)` : item.handle,
      accuracy: accuracyText,
      score: scoreText,
      team,
      isUser,
      xp,
      score_raw:
        metric === 'rank'
          ? xp
          : metric === 'wins'
            ? item.completed_weekly || 0
            : item.max_streak || 0,
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const metric = url.searchParams.get('metric') || 'rank';
    if (!METRICS.has(metric)) {
      sendJson(res, 400, { error: 'Invalid metric' });
      return;
    }

    const username = url.searchParams.get('username') || '';
    const supabase = getSupabaseAdmin();

    const orderCol =
      metric === 'wins'
        ? 'completed_weekly'
        : metric === 'streak'
          ? 'max_streak'
          : 'xp';

    const { data, error } = await supabase
      .from('user_stats')
      .select('handle, xp, completed_weekly, max_streak, overall_accuracy, profiles(favorite_team)')
      .order(orderCol, { ascending: false })
      .limit(50);

    if (error) {
      sendJson(res, 500, { error: error.message });
      return;
    }

    const rows = mapCrewRows(data || [], username, metric);
    sendJson(res, 200, { rows, metric, source: rows.length ? 'live' : 'empty' });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Failed to load crew leaderboard' });
  }
}
