import fs from 'node:fs';
import path from 'node:path';
import { sendJson, readJsonBody } from '../../_lib/http.js';
import { getAdminFromRequest } from '../../_lib/admin-session.js';
import { getIsoWeekKey } from '../../_lib/period.js';
import { normalizeWeeklyGenerationConfig } from '../../../src/js/weekly-generation-config.js';
import {
  CONFIG_PATH,
  loadConfigFromFile,
  runWeeklyCurator,
} from '../../../scripts/lib/weekly-curator-core.mjs';
import {
  assignBundleToWeek,
  unassignWeek,
  buildAdminDashboard,
  bootstrapFromLiveBundleIfEmpty,
  resetWeeklyLeaderboard,
  persistCuratorResult,
  loadBundleJson,
  summarizeBundleForAdmin,
  deleteBundle,
  getWeeksUsingBundle,
  deployBundleToLiveApp,
  LIVE_BUNDLE_PATH,
} from '../../../scripts/lib/weekly-schedule.mjs';
import { getStorageMode } from '../../../scripts/lib/weekly-storage.mjs';

function readGenerationConfig() {
  try {
    return loadConfigFromFile(CONFIG_PATH);
  } catch {
    return normalizeWeeklyGenerationConfig(null);
  }
}

async function handleGet() {
  await bootstrapFromLiveBundleIfEmpty();
  const dash = await buildAdminDashboard();
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
    const schedule = (await buildAdminDashboard()).schedule;
    const previous = schedule.assignments[weekId];
    const reassigned = isCurrent && previous?.bundleId && previous.bundleId !== bundleId;

    await assignBundleToWeek(weekId, bundleId, { assignedBy: 'admin' });

    let leaderboardReset = null;
    if (isCurrent && (body.resetLeaderboard !== false || reassigned)) {
      leaderboardReset = await resetWeeklyLeaderboard(weekId);
    }

    let deploy = null;
    if (isCurrent && body.deployLive !== false) {
      const bundle = await loadBundleJson(bundleId);
      deploy = deployBundleToLiveApp(bundle);
    }

    const storageMode = getStorageMode();
    let message;
    if (!isCurrent) {
      message = `Assigned to ${weekId}.`;
    } else if (deploy?.published) {
      message = 'Assigned, leaderboard reset, and live app file updated.';
    } else if (storageMode === 'supabase') {
      message =
        'Assigned and leaderboard reset. Players load this bundle from /api/weekly-challenge on their next visit (no git deploy required).';
    } else {
      message =
        'Assigned and leaderboard reset. Live file unchanged (read-only deploy) — sync via CI or local deploy.';
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
      message,
    };
  }

  if (action === 'unassignWeek') {
    const { weekId } = body;
    if (!weekId) return { ok: false, error: 'weekId required' };
    if (weekId === getIsoWeekKey()) {
      return { ok: false, error: 'Cannot unassign the current week — assign a different bundle instead.' };
    }
    await unassignWeek(weekId);
    return { ok: true, action, weekId };
  }

  if (action === 'resetLeaderboard') {
    const weekId = body.weekId || getIsoWeekKey();
    const leaderboardReset = await resetWeeklyLeaderboard(weekId);
    return { ok: true, action, leaderboardReset };
  }

  if (action === 'deployLive') {
    const weekId = body.weekId || getIsoWeekKey();
    const assignment = (await buildAdminDashboard()).schedule.assignments[weekId];
    if (!assignment?.bundleId) {
      return { ok: false, error: `No bundle assigned to ${weekId}` };
    }
    const bundle = await loadBundleJson(assignment.bundleId);
    const deploy = deployBundleToLiveApp(bundle);
    return { ok: true, action, weekId, bundleId: assignment.bundleId, deploy };
  }

  if (action === 'getBundle') {
    const bundle = await loadBundleJson(body.bundleId);
    if (!bundle) return { ok: false, error: 'Bundle not found' };
    const usedByWeeks = await getWeeksUsingBundle(body.bundleId);
    return {
      ok: true,
      action,
      bundleId: body.bundleId,
      usedByWeeks,
      canDelete: usedByWeeks.length === 0,
      detail: summarizeBundleForAdmin(bundle),
    };
  }

  if (action === 'deleteBundle') {
    await deleteBundle(body.bundleId);
    return { ok: true, action, bundleId: body.bundleId };
  }

  if (action === 'generateBundle') {
    const config = normalizeWeeklyGenerationConfig(body.config || readGenerationConfig());
    if (body.weekId) config.scheduleForWeekId = body.weekId;
    const result = await runWeeklyCurator(config, { log: false, delayMs: 600 });
    const { bundle, summary } = await persistCuratorResult(result, {
      label: body.label || `Generated ${result.meta?.challengeWeekId || 'draft'}`,
      bundleId: body.bundleId,
    });
    const usedByWeeks = await getWeeksUsingBundle(bundle.id);
    return {
      ok: true,
      action,
      bundleId: bundle.id,
      summary: { ...summary, usedByWeeks },
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
    try {
      fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    } catch (e) {
      if (e.code === 'EROFS') {
        return {
          ok: false,
          error: 'Cannot save generator defaults on read-only deploy. Edit weekly_generation_config.json locally.',
        };
      }
      throw e;
    }
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
      sendJson(res, 200, await handleGet());
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
    const message =
      err.code === 'EROFS'
        ? 'Server storage is read-only. Configure Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) on this deployment.'
        : err.message || 'Challenge admin request failed';
    sendJson(res, 500, { error: message });
  }
}
