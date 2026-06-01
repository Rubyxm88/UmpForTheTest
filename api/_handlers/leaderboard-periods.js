import { sendJson } from '../_lib/http.js';

const BOARDS = new Set(['weekly', 'daily']);

export function summarizePeriods(rows) {
  const grouped = new Map();

  for (const row of rows || []) {
    if (!grouped.has(row.period_key)) {
      grouped.set(row.period_key, []);
    }
    grouped.get(row.period_key).push(row);
  }

  return [...grouped.entries()]
    .map(([periodKey, entries]) => {
      const sorted = [...entries].sort((a, b) => (b.score_raw || 0) - (a.score_raw || 0));
      const winner = sorted[0];
      return {
        periodKey,
        winnerHandle: winner?.handle || null,
        winnerScore: winner?.score_text || String(winner?.score_raw ?? ''),
        winnerAccuracy: winner?.accuracy || null,
        entryCount: sorted.length,
      };
    })
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey));
}

export async function handleLeaderboardPeriods(req, res, supabase) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const board = url.searchParams.get('board') || 'weekly';
  if (!BOARDS.has(board)) {
    sendJson(res, 400, { error: 'Invalid board' });
    return;
  }

  const { data, error } = await supabase
    .from('leaderboard_entries')
    .select('period_key, handle, score_raw, score_text, accuracy')
    .eq('board', board)
    .order('period_key', { ascending: false })
    .limit(2000);

  if (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }

  const periods = summarizePeriods(data);
  sendJson(res, 200, {
    board,
    periods,
    source: periods.length ? 'live' : 'empty',
  });
}
