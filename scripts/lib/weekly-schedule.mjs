/**
 * Weekly challenge schedule + bundle library (filesystem).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIsoWeekKey } from '../../api/_lib/period.js';
import { getSupabaseAdmin } from '../../api/_lib/supabase.js';
import {
  formatWeeklyBundleFile,
  writeWeeklyBundle,
  DEFAULT_OUTPUT_PATH,
} from './weekly-curator-core.mjs';
import { summarizePlaylistBuild } from '../../src/js/weekly-playlist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '../../src/data');
export const SCHEDULE_PATH = path.join(DATA_ROOT, 'weekly_schedule.json');
export const BUNDLES_DIR = path.join(DATA_ROOT, 'weekly_bundles');
export const CATALOG_PATH = path.join(BUNDLES_DIR, 'catalog.json');
export const LIVE_BUNDLE_PATH = DEFAULT_OUTPUT_PATH;

const DEFAULT_SCHEDULE = { version: 1, assignments: {} };

export function canWriteDataFiles() {
  try {
    const probe = path.join(DATA_ROOT, '.write_probe');
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function loadSchedule() {
  if (!fs.existsSync(SCHEDULE_PATH)) {
    return { ...DEFAULT_SCHEDULE, assignments: {} };
  }
  return { ...DEFAULT_SCHEDULE, ...JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8')) };
}

export function saveSchedule(schedule) {
  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULE_PATH, `${JSON.stringify(schedule, null, 2)}\n`, 'utf8');
}

export function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    return { version: 1, bundles: [] };
  }
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return { version: 1, bundles: raw.bundles || [] };
}

export function saveCatalog(catalog) {
  fs.mkdirSync(BUNDLES_DIR, { recursive: true });
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

export function bundleFilePath(bundleId) {
  return path.join(BUNDLES_DIR, `${bundleId}.json`);
}

export function loadBundleJson(bundleId) {
  const file = bundleFilePath(bundleId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveBundleJson(bundle) {
  const id = bundle.id;
  if (!id) throw new Error('Bundle id required');
  fs.mkdirSync(BUNDLES_DIR, { recursive: true });
  fs.writeFileSync(bundleFilePath(id), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

  const catalog = loadCatalog();
  const pitchCount = (bundle.games || []).reduce((s, g) => s + (g.pitches?.length || 0), 0);
  const summary = {
    id,
    label: bundle.label || id,
    createdAt: bundle.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    challengeWeekId: bundle.meta?.challengeWeekId || null,
    gameCount: bundle.games?.length || 0,
    targetAtBats: bundle.meta?.targetAtBats ?? 20,
    pitchCount,
    gameTitles: (bundle.games || []).slice(0, 5).map((g) => g.title),
  };

  const idx = catalog.bundles.findIndex((b) => b.id === id);
  if (idx >= 0) catalog.bundles[idx] = { ...catalog.bundles[idx], ...summary };
  else catalog.bundles.unshift(summary);
  saveCatalog(catalog);
  return summary;
}

export function deleteBundle(bundleId) {
  const file = bundleFilePath(bundleId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const catalog = loadCatalog();
  catalog.bundles = catalog.bundles.filter((b) => b.id !== bundleId);
  saveCatalog(catalog);
  const schedule = loadSchedule();
  let changed = false;
  for (const [weekId, a] of Object.entries(schedule.assignments || {})) {
    if (a?.bundleId === bundleId) {
      delete schedule.assignments[weekId];
      changed = true;
    }
  }
  if (changed) saveSchedule(schedule);
}

/** Newest-first timeline: future (5) → current → past (12). */
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

export function getBundleSummary(bundleId, catalog = loadCatalog()) {
  return catalog.bundles.find((b) => b.id === bundleId) || null;
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
    playlistStats,
    games: games.map((g) => ({
      id: g.id,
      title: g.title,
      gamePk: g.gamePk,
      pitchCount: g.pitches?.length || 0,
    })),
    atBatsPreview: abs.slice(0, 40),
    atBatTotal: abs.length,
  };
}

export function assignBundleToWeek(weekId, bundleId, { assignedBy = 'admin' } = {}) {
  const bundle = loadBundleJson(bundleId);
  if (!bundle) throw new Error(`Bundle not found: ${bundleId}`);

  const schedule = loadSchedule();
  schedule.assignments[weekId] = {
    bundleId,
    assignedAt: new Date().toISOString(),
    assignedBy,
  };
  saveSchedule(schedule);

  bundle.meta = { ...bundle.meta, challengeWeekId: weekId };
  saveBundleJson(bundle);

  return { schedule, bundle: getBundleSummary(bundleId) };
}

export function unassignWeek(weekId) {
  const schedule = loadSchedule();
  delete schedule.assignments[weekId];
  saveSchedule(schedule);
  return schedule;
}

export function deployBundleToLiveApp(bundleId) {
  const bundle = loadBundleJson(bundleId);
  if (!bundle) throw new Error(`Bundle not found: ${bundleId}`);
  const writeInfo = writeWeeklyBundle(bundle.games, bundle.meta, LIVE_BUNDLE_PATH);
  return { writeInfo, meta: bundle.meta };
}

export function getWeeksUsingBundle(bundleId, schedule = loadSchedule()) {
  return Object.entries(schedule.assignments || {})
    .filter(([, a]) => a?.bundleId === bundleId)
    .map(([weekId]) => weekId);
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
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from('leaderboard_entries')
    .select('*', { count: 'exact', head: true })
    .eq('board', 'weekly')
    .eq('period_key', weekId);
  if (error) return null;
  return count ?? 0;
}

export function buildAdminDashboard() {
  const schedule = loadSchedule();
  const catalog = loadCatalog();
  const currentIsoWeek = getIsoWeekKey();
  const timeline = buildWeekTimeline().map((slot) => {
    const assignment = schedule.assignments[slot.weekId] || null;
    const bundle = assignment ? getBundleSummary(assignment.bundleId, catalog) : null;
    return {
      ...slot,
      assignment,
      bundle,
    };
  });

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
          matchesAssignment:
            assigned?.bundleId &&
            meta.challengeWeekId === currentIsoWeek,
          assignedBundleId: assigned?.bundleId || null,
        };
      }
    } catch {
      live = { error: 'Could not parse live bundle' };
    }
  }

  return {
    currentIsoWeek,
    timeline,
    schedule,
    catalog: catalog.bundles,
    live,
    writable: canWriteDataFiles(),
  };
}

/** Create catalog entry + JSON from curator result. */
export function persistCuratorResult(result, { label, bundleId } = {}) {
  const id =
    bundleId ||
    `bundle-${(result.meta?.challengeWeekId || 'draft').replace('-', '')}-${Date.now().toString(36).slice(-4)}`;
  const bundle = {
    id,
    label: label || `Bundle ${id}`,
    createdAt: new Date().toISOString(),
    meta: result.meta,
    games: result.games,
  };
  saveBundleJson(bundle);
  return { bundle, summary: getBundleSummary(id) };
}

export function parseLiveBundleMeta() {
  if (!fs.existsSync(LIVE_BUNDLE_PATH)) return null;
  const text = fs.readFileSync(LIVE_BUNDLE_PATH, 'utf8');
  const metaMatch = text.match(/export const WEEKLY_CHALLENGE_META = (\{[\s\S]*?\n\});/);
  if (!metaMatch) return null;
  return Function(`"use strict"; return (${metaMatch[1]});`)();
}

/** Bootstrap schedule + catalog from existing weekly_challenge.js once. */
export function bootstrapFromLiveBundleIfEmpty() {
  const catalog = loadCatalog();
  if (catalog.bundles.length > 0) return null;

  const meta = parseLiveBundleMeta();
  if (!meta) return null;

  const text = fs.readFileSync(LIVE_BUNDLE_PATH, 'utf8');
  const dataMatch = text.match(/export const WEEKLY_CHALLENGE_DATA = (\[[\s\S]*\]);/);
  if (!dataMatch) return null;

  const games = Function(`"use strict"; return (${dataMatch[1]});`)();
  const weekId = meta.challengeWeekId || getIsoWeekKey();
  const id = `bundle-${weekId}`;
  const bundle = {
    id,
    label: `Imported ${weekId}`,
    createdAt: new Date().toISOString(),
    meta,
    games,
  };
  saveBundleJson(bundle);
  const schedule = loadSchedule();
  schedule.assignments[weekId] = {
    bundleId: id,
    assignedAt: new Date().toISOString(),
    assignedBy: 'bootstrap',
  };
  saveSchedule(schedule);
  return { bundleId: id, weekId };
}
