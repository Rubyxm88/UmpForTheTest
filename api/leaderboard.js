import { getHandleFromRequest } from './_lib/session.js';
import { normalizeHandle, readJsonBody, sendJson } from './_lib/http.js';
import { getSupabaseAdmin } from './_lib/supabase.js';
import { resolvePeriodKey } from './_lib/period.js';

const BOARDS = new Set(['weekly', 'daily', 'alltime']);

function mapLeaderboardRows(list, username) {
  const normalizedUser = normalizeHandle(username);
  const sorted = [...list].sort((a, b) => (b.score_raw || 0) - (a.score_raw || 0));

  return sorted.slice(0, 50).map((item, idx) => {
    const isUser = normalizeHandle(item.handle) === normalizedUser;
    const accuracy =
      typeof item.accuracy === 'string'
        ? item.accuracy
        : `${item.accuracy ?? 0}%`;
    return {
      rank: idx + 1,
      name: isUser ? `${normalizedUser} (YOU)` : item.handle,
      accuracy,
      score: item.score_text || String(item.score_raw ?? ''),
      team: item.team || 'None',
      isUser,
    };
  });
}

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin();

  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const board = url.searchParams.get('board') || 'weekly';
      if (!BOARDS.has(board)) {
        sendJson(res, 400, { error: 'Invalid board' });
        return;
      }

      const periodKey = resolvePeriodKey(
        board,
        url.searchParams.get('period') || undefined
      );
      const username = url.searchParams.get('username') || '';

      const { data, error } = await supabase
        .from('leaderboard_entries')
        .select('handle, team, accuracy, score_raw, score_text')
        .eq('board', board)
        .eq('period_key', periodKey)
        .order('score_raw', { ascending: false })
        .limit(50);

      if (error) {
        sendJson(res, 500, { error: error.message });
        return;
      }

      const rows = mapLeaderboardRows(data || [], username);
      sendJson(res, 200, { rows, periodKey, source: rows.length ? 'live' : 'empty' });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Failed to load leaderboard' });
    }
    return;
  }

  if (req.method === 'POST') {
    const handle = getHandleFromRequest(req);
    if (!handle) {
      sendJson(res, 401, { error: 'Not authenticated' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const board = body.board;
      if (!BOARDS.has(board)) {
        sendJson(res, 400, { error: 'Invalid board' });
        return;
      }

      const periodKey = resolvePeriodKey(board, body.periodKey);
      const scoreRaw = Number(body.scoreRaw);
      if (!Number.isFinite(scoreRaw)) {
        sendJson(res, 400, { error: 'Invalid scoreRaw' });
        return;
      }

      const { error } = await supabase.from('leaderboard_entries').upsert(
        {
          board,
          period_key: periodKey,
          handle,
          team: body.team || 'none',
          accuracy: body.accuracy || null,
          score_raw: scoreRaw,
          score_text: body.scoreText || String(scoreRaw),
          submitted_at: new Date().toISOString(),
        },
        { onConflict: 'board,period_key,handle' }
      );

      if (error) {
        sendJson(res, 500, { error: error.message });
        return;
      }

      sendJson(res, 200, { ok: true, periodKey });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Failed to submit score' });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}
