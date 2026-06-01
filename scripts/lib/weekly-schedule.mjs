/**
 * Weekly challenge schedule + bundle library orchestration.
 */

import fs from 'node:fs';
import { getIsoWeekKey } from '../../api/_lib/period.js';
import { getSupabaseAdmin } from '../../api/_lib/supabase.js';
import { writeWeeklyBundle, DEFAULT_OUTPUT_PATH } from './weekly-curator-core.mjs';
import { summarizePlaylistBuild } from '../../src/js/weekly-playlist.js';
import {
  attachUsedByWeeks,
  canWriteFilesystem,
  deleteBundle as storageDeleteBundle,
  getStorageMode,
  getWeeksUsingBundle,
  loadBundle,
  loadCatalog,
  loadSchedule,
  removeScheduleAssignment,
  saveBundle,
  saveScheduleAssignment,
} from './weekly-storage.mjs';

export { SCHEDULE_PATH, BUNDLES_DIR, CATALOG_PATH } from './weekly-storage.mjs';
export const LIVE_BUNDLE_PATH = DEFAULT_OUTPUT_PATH;

export function canWriteDataFiles() {
  return canWriteFilesystem();
}

export async function saveBundleJson(bundle) {
  return saveBundle(bundle);
}

export async function loadBundleJson(bundleId) {
  return loadBundle(bundleId);
}

export { deleteBundle } from './weekly-storage.mjs';

export function buildWeekTimeline(anchorDate = new Date(), { futureCount = 5, pastCount = 12 } = {}) {
  const current = getIsoWeekKey(anchorDate);
  const ids = new Set();
  const base = new Date(anchorDate);
  for (let i = futureCount; i >= 1; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() + i * 7);
    ids.add(getIsoWeekKey(d));
  }
  ids.add(current);
  for (let i = 1; i <= pastCount; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i * 7);
    ids.add(getIsoWeekKey(d));
  }
  return [...ids]
    .sort((a, b) => b.localeCompare(a))
    .map((weekId) => ({
      weekId,
      period: weekId > current ? 'future' : weekId === current ? 'current' : 'past',
    }));
}

export function summarizeBundleForAdmin(bundle) {
  if (!bundle) return null;
  const playlistStats = summarizePlaylistBuild(
    bundle.games || [],
    bundle.meta || {},
    bundle.meta?.generation || null
  );
  const abs = [];
  const games = bundle.games || [];
  games.forEach((game, gameIdx) => {
    let cur = [];
    let batter = '';
    game.pitches?.forEach((pitch) => {
      if (pitch.batter !== batter && cur.length) {
        abs.push({
          gameIndex: gameIdx,
          gameTitle: game.title,
          batter: cur[0]?.batter,
          pitcher: cur[0]?.pitcher,
          pitchCount: cur.length,
        });
        cur = [];
      }
      batter = pitch.batter;
      cur.push(pitch);
    });
    if (cur.length) {
      abs.push({
        gameIndex: gameIdx,
        gameTitle: game.title,
        batter: cur[0]?.batter,
        pitcher: cur[0]?.pitcher,
        pitchCount: cur.length,
      });
    }
  });
  return {
    meta: bundle.meta,
    label: bundle.label,
    id: bundle.id,
    playlistStats,
    games: games.map((g) => ({
      id: g.id,
      title: g.title,
      gamePk: g.gamePk,
      pitchCount: g.pitches?.length || 0,
    })),
    atBatsPreview: abs.slice(0, 50),
    atBatTotal: abs.length,
  };
}

export async function assignBundleToWeek(weekId, bundleId, { assignedBy = 'admin' } = {}) {
  const bundle = await loadBundle(bundleId);
  if (!bundle) throw new Error(`Bundle not found: ${bundleId}`);

  await saveScheduleAssignment(weekId, bundleId, assignedBy);

  bundle.meta = { ...bundle.meta, challengeWeekId: weekId };
  const summary = await saveBundle(bundle);

  return { bundle: summary };
}

export async function unassignWeek(weekId) {
  return removeScheduleAssignment(weekId);
}

export function deployBundleToLiveApp(bundle) {
  if (!canWriteFilesystem()) {
    return {
      published: false,
      writable: false,
      message:
        'Assignment saved in database. To update the player app file, run deploy from local dev or merge a CI commit to weekly_challenge.js.',
    };
  }
  const writeInfo = writeWeeklyBundle(bundle.games, bundle.meta, LIVE_BUNDLE_PATH);
  return { published: true, writable: true, writeInfo, meta: bundle.meta };
}

export async function resetWeeklyLeaderboard(weekId) {
  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from('leaderboard_entries')
    .delete({ count: 'exact' })
    .eq('board', 'weekly')
    .eq('period_key', weekId);
  if (error) throw new Error(error.message);
  return { deleted: count ?? 0, weekId };
}

export async function getLeaderboardEntryCount(weekId) {
  try {
    const supabase = getSupabaseAdmin();
    const { count, error } = await supabase
      .from('leaderboard_entries')
      .select('*', { count: 'exact', head: true })
      .eq('board', 'weekly')
      .eq('period_key', weekId);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function buildAdminDashboard() {
  const schedule = await loadSchedule();
  let catalog = attachUsedByWeeks(await loadCatalog(), schedule);
  const currentIsoWeek = getIsoWeekKey();
  const timeline = buildWeekTimeline();

  const enriched = [];
  for (const slot of timeline) {
    const assignment = schedule.assignments[slot.weekId] || null;
    const bundle = assignment
      ? catalog.find((b) => b.id === assignment.bundleId) || null
      : null;
    const leaderboardEntries = await getLeaderboardEntryCount(slot.weekId);
    enriched.push({ ...slot, assignment, bundle, leaderboardEntries });
  }

  let live = null;
  if (fs.existsSync(LIVE_BUNDLE_PATH)) {
    try {
      const text = fs.readFileSync(LIVE_BUNDLE_PATH, 'utf8');
      const metaMatch = text.match(/export const WEEKLY_CHALLENGE_META = (\{[\s\S]*?\n\});/);
      if (metaMatch) {
        const meta = Function(`"use strict"; return (${metaMatch[1]});`)();
        const assigned = schedule.assignments[currentIsoWeek];
        live = {
          meta,
          fileBytes: text.length,
          weekAligned: meta.challengeWeekId === currentIsoWeek,
          assignedBundleId: assigned?.bundleId || null,
        };
      }
    } catch {
      live = { error: 'Could not parse live bundle' };
    }
  }

  const storageMode = getStorageMode();

  return {
    currentIsoWeek,
    timeline: enriched,
    schedule,
    catalog,
    live,
    writable: canWriteFilesystem(),
    storageMode,
    canPersistBundles: storageMode !== 'none',
  };
}

export async function persistCuratorResult(result, { label, bundleId } = {}) {
  const id =
    bundleId ||
    `bundle-${(result.meta?.challengeWeekId || 'draft').replace(/-/g, '')}-${Date.now().toString(36).slice(-4)}`;
  const bundle = {
    id,
    label: label || `Bundle ${id}`,
    createdAt: new Date().toISOString(),
    meta: result.meta,
    games: result.games,
  };
  const summary = await saveBundle(bundle);
  return { bundle, summary };
}

export async function bootstrapFromLiveBundleIfEmpty() {
  const catalog = await loadCatalog();
  if (catalog.length > 0) return null;
  if (getStorageMode() === 'none') return null;
  if (!fs.existsSync(LIVE_BUNDLE_PATH)) return null;

  const text = fs.readFileSync(LIVE_BUNDLE_PATH, 'utf8');
  const metaMatch = text.match(/export const WEEKLY_CHALLENGE_META = (\{[\s\S]*?\n\});/);
  const dataMatch = text.match(/export const WEEKLY_CHALLENGE_DATA = (\[[\s\S]*\]);/);
  if (!metaMatch || !dataMatch) return null;

  const meta = Function(`"use strict"; return (${metaMatch[1]});`)();
  const games = Function(`"use strict"; return (${dataMatch[1]});`)();
  const weekId = meta.challengeWeekId || getIsoWeekKey();
  const id = `bundle-${weekId}`;

  await saveBundle({
    id,
    label: `Imported ${weekId}`,
    createdAt: new Date().toISOString(),
    meta,
    games,
  });
  await saveScheduleAssignment(weekId, id, 'bootstrap');
  return { bundleId: id, weekId };
}
