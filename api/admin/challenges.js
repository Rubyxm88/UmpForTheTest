import { sendJson, readJsonBody } from '../_lib/http.js';
import { getAdminFromRequest } from '../_lib/admin-session.js';
import { getIsoWeekKey } from '../_lib/period.js';
import { normalizeWeeklyGenerationConfig } from '../../src/js/weekly-generation-config.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONFIG_PATH,
  loadConfigFromFile,
  runWeeklyCurator,
} from '../../scripts/lib/weekly-curator-core.mjs';
import {
  assignBundleToWeek,
  unassignWeek,
  deployBundleToLiveApp,
  deleteBundle,
  loadBundleJson,
  summarizeBundleForAdmin,
  persistCuratorResult,
  buildAdminDashboard,
  bootstrapFromLiveBundleIfEmpty,
  resetWeeklyLeaderboard,
  getLeaderboardEntryCount,
  getWeeksUsingBundle,
  canWriteDataFiles,
} from '../../scripts/lib/weekly-schedule.mjs';

function readGenerationConfig() {
  try {
    return loadConfigFromFile(CONFIG_PATH);
  } catch {
    return normalizeWeeklyGenerationConfig(null);
  }
}

async function enrichTimelineWithLeaderboardCounts(timeline) {
  const out = [];
  for (const slot of timeline) {
    let leaderboardEntries = null;
    try {
      leaderboardEntries = await getLeaderboardEntryCount(slot.weekId);
    } catch {
      leaderboardEntries = null;
    }
    out.push({ ...slot, leaderboardEntries });
  }
  return out;
}

async function handleGet() {
  bootstrapFromLiveBundleIfEmpty();
  const dash = buildAdminDashboard();
  dash.timeline = await enrichTimelineWithLeaderboardCounts(dash.timeline);
  dash.config = readGenerationConfig();
  return { ok: true, ...dash };
}

async function handlePost(body) {
  const action = body.action;

  if (action === 'assignWeek') {
    const { weekId, bundleId } = body;
    if (!weekId || !bundleId) {
      return { ok: false, error: 'weekId and bundleId required' };
    }
    const current = getIsoWeekKey();
    const isCurrent = weekId === current;
    const previous = buildAdminDashboard().schedule.assignments[weekId];
    const reassigned =
      isCurrent && previous?.bundleId && previous.bundleId !== bundleId;

    assignBundleToWeek(weekId, bundleId, { assignedBy: 'admin' });

    let leaderboardReset = null;
    if (isCurrent && (body.resetLeaderboard !== false || reassigned)) {
      leaderboardReset = await resetWeeklyLeaderboard(weekId);
    }

    let deploy = null;
    if (isCurrent && body.deployLive !== false && canWriteDataFiles()) {
      deploy = deployBundleToLiveApp(bundleId);
    }

    return {
      ok: true,
      action,
      weekId,
      bundleId,
      isCurrent,
      reassigned,
      leaderboardReset,
      deploy,
      message: isCurrent
        ? 'Assigned to current week. Leaderboard reset and live app bundle updated.'
        : `Assigned to ${weekId}.`,
    };
  }

  if (action === 'unassignWeek') {
    const { weekId } = body;
    if (!weekId) return { ok: false, error: 'weekId required' };
    const current = getIsoWeekKey();
    if (weekId === current) {
      return { ok: false, error: 'Cannot unassign the current calendar week — assign a different bundle instead.' };
    }
    unassignWeek(weekId);
    return { ok: true, action, weekId };
  }

  if (action === 'resetLeaderboard') {
    const weekId = body.weekId || getIsoWeekKey();
    const leaderboardReset = await resetWeeklyLeaderboard(weekId);
    return { ok: true, action, leaderboardReset };
  }

  if (action === 'deployLive') {
    const weekId = body.weekId || getIsoWeekKey();
    const assignment = buildAdminDashboard().schedule.assignments[weekId];
    if (!assignment?.bundleId) {
      return { ok: false, error: `No bundle assigned to ${weekId}` };
    }
    if (!canWriteDataFiles()) {
      return { ok: false, error: 'Filesystem read-only — deploy from local dev or CI.' };
    }
    const deploy = deployBundleToLiveApp(assignment.bundleId);
    return { ok: true, action, weekId, bundleId: assignment.bundleId, deploy };
  }

  if (action === 'getBundle') {
    const bundle = loadBundleJson(body.bundleId);
    if (!bundle) return { ok: false, error: 'Bundle not found' };
    const usedByWeeks = getWeeksUsingBundle(body.bundleId);
    return {
      ok: true,
      action,
      bundleId: body.bundleId,
      usedByWeeks,
      detail: summarizeBundleForAdmin(bundle),
    };
  }

  if (action === 'deleteBundle') {
    const used = getWeeksUsingBundle(body.bundleId);
    if (used.length) {
      return { ok: false, error: `Bundle is assigned to: ${used.join(', ')}` };
    }
    deleteBundle(body.bundleId);
    return { ok: true, action, bundleId: body.bundleId };
  }

  if (action === 'generateBundle') {
    const config = normalizeWeeklyGenerationConfig(body.config || readGenerationConfig());
    if (body.weekId) {
      config.scheduleForWeekId = body.weekId;
    }
    const result = await runWeeklyCurator(config, { log: false, delayMs: 600 });
    const { bundle, summary } = persistCuratorResult(result, {
      label: body.label || `Generated ${result.meta?.challengeWeekId || 'draft'}`,
      bundleId: body.bundleId,
    });
    return {
      ok: true,
      action,
      bundleId: bundle.id,
      summary,
      playlistStats: result.playlistStats,
      meta: result.meta,
    };
  }

  if (action === 'previewGenerate') {
    const config = normalizeWeeklyGenerationConfig(body.config || readGenerationConfig());
    const previewGames = Math.min(config.games.count, Number(body.maxGames) || 2);
    const result = await runWeeklyCurator(config, {
      log: false,
      maxGames: previewGames,
      delayMs: 400,
    });
    return {
      ok: true,
      action,
      playlistStats: result.playlistStats,
      games: result.games.map((g) => ({
        title: g.title,
        gamePk: g.gamePk,
        pitchCount: g.pitches.length,
      })),
      note: `Preview used ${previewGames} game(s).`,
    };
  }

  if (action === 'saveConfig') {
    const normalized = normalizeWeeklyGenerationConfig(body.config);
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return { ok: true, action, config: normalized };
  }

  return { ok: false, error: `Unknown action: ${action}` };
}

export default async function handler(req, res) {
  if (!getAdminFromRequest(req)) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const data = await handleGet();
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = await handlePost(body);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('admin/challenges:', err);
    sendJson(res, 500, { error: err.message || 'Challenge admin request failed' });
  }
}
