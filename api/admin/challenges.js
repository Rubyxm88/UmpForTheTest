import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson } from '../_lib/http.js';
import { getAdminFromRequest } from '../_lib/admin-session.js';
import { getIsoWeekKey } from '../_lib/period.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEEKLY_PATH = path.resolve(__dirname, '../../src/data/weekly_challenge.js');

/** Parse JS object literal (unquoted keys) from weekly_challenge.js exports. */
function parseJsObjectLiteral(source) {
  const trimmed = String(source || '').trim();
  if (!trimmed.startsWith('{')) {
    throw new SyntaxError('Expected object literal');
  }
  return Function(`"use strict"; return (${trimmed});`)();
}

function parseWeeklyBundle() {
  if (!fs.existsSync(WEEKLY_PATH)) {
    return { ok: false, error: 'weekly_challenge.js not found' };
  }

  const text = fs.readFileSync(WEEKLY_PATH, 'utf8');
  const metaMatch = text.match(/export const WEEKLY_CHALLENGE_META = (\{[\s\S]*?\n\});/);
  if (!metaMatch) {
    return { ok: false, error: 'WEEKLY_CHALLENGE_META not found in bundle' };
  }

  let meta;
  try {
    meta = parseJsObjectLiteral(metaMatch[1]);
  } catch (e) {
    return { ok: false, error: `Invalid challenge meta: ${e.message}` };
  }

  const gameIdMatches = [...text.matchAll(/"id":\s*"(game_\d+)"/g)];
  const titleMatches = [...text.matchAll(/"title":\s*"([^"]+)"/g)];
  const gamePkMatches = [...text.matchAll(/"gamePk":\s*(\d+)/g)];

  const gameCount = Math.min(meta.gameCount ?? 5, gameIdMatches.length) || gameIdMatches.length;
  const gameSummaries = gameIdMatches.slice(0, gameCount).map((m, idx) => ({
    index: idx,
    id: m[1],
    title: titleMatches[idx]?.[1] || '—',
    gamePk: gamePkMatches[idx] ? Number(gamePkMatches[idx][1]) : null,
    pitchCount: null,
  }));

  const totalPitches = (text.match(/"real_ump_call":/g) || []).length;
  const hasTrajectories = text.includes('"vx0"') && text.includes('"sz_top"');
  gameSummaries.forEach((g) => {
    g.hasTrajectories = hasTrajectories;
    g.pitchCount = gameSummaries.length
      ? Math.round(totalPitches / gameSummaries.length)
      : 0;
  });
  const currentIsoWeek = getIsoWeekKey();
  const metaWeek = meta.challengeWeekId;
  const weekAligned = metaWeek === currentIsoWeek;

  return {
    ok: true,
    meta,
    currentIsoWeek,
    weekAligned,
    gameCount: gameSummaries.length,
    totalPitches,
    targetAtBats: meta.targetAtBats ?? 200,
    games: gameSummaries,
    fileBytes: text.length,
    fileModified: fs.statSync(WEEKLY_PATH).mtime.toISOString(),
    health: {
      hasFiveGames: gameSummaries.length >= 5,
      hasPitches: totalPitches > 100,
      weekIdPresent: Boolean(metaWeek),
      gamePksPresent: Array.isArray(meta.gamePks) && meta.gamePks.length >= 5,
      trajectoriesOk: hasTrajectories,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!getAdminFromRequest(req)) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  try {
    const bundle = parseWeeklyBundle();
    if (!bundle.ok) {
      sendJson(res, 500, { error: bundle.error });
      return;
    }

    sendJson(res, 200, bundle);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Failed to inspect challenges' });
  }
}
