/**
 * Weekly challenge persistence: Supabase (serverless) with filesystem fallback (local git).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSupabaseConfigured, getSupabaseAdmin } from '../../api/_lib/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '../../src/data');
export const SCHEDULE_PATH = path.join(DATA_ROOT, 'weekly_schedule.json');
export const BUNDLES_DIR = path.join(DATA_ROOT, 'weekly_bundles');
export const CATALOG_PATH = path.join(BUNDLES_DIR, 'catalog.json');

export function canWriteFilesystem() {
  try {
    const probe = path.join(DATA_ROOT, '.write_probe');
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Prefer Supabase when configured (required on Vercel). */
export function getStorageMode() {
  if (isSupabaseConfigured()) return 'supabase';
  if (canWriteFilesystem()) return 'filesystem';
  return 'none';
}

function bundlePath(bundleId) {
  return path.join(BUNDLES_DIR, `${bundleId}.json`);
}

// —— Filesystem ——

function fsLoadSchedule() {
  if (!fs.existsSync(SCHEDULE_PATH)) return { version: 1, assignments: {} };
  return { version: 1, ...JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8')) };
}

function fsSaveSchedule(schedule) {
  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULE_PATH, `${JSON.stringify(schedule, null, 2)}\n`, 'utf8');
}

function fsLoadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) return [];
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return raw.bundles || [];
}

function fsSaveCatalogSummaries(bundles) {
  fs.mkdirSync(BUNDLES_DIR, { recursive: true });
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify({ version: 1, bundles }, null, 2)}\n`, 'utf8');
}

function fsLoadBundle(bundleId) {
  const file = bundlePath(bundleId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fsSaveBundle(bundle) {
  fs.mkdirSync(BUNDLES_DIR, { recursive: true });
  fs.writeFileSync(bundlePath(bundle.id), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
}

function fsDeleteBundle(bundleId) {
  const file = bundlePath(bundleId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function summarizeBundle(bundle) {
  const pitchCount = (bundle.games || []).reduce((s, g) => s + (g.pitches?.length || 0), 0);
  return {
    id: bundle.id,
    label: bundle.label || bundle.id,
    createdAt: bundle.createdAt || new Date().toISOString(),
    updatedAt: bundle.updatedAt || new Date().toISOString(),
    challengeWeekId: bundle.meta?.challengeWeekId || null,
    gameCount: bundle.games?.length || 0,
    targetAtBats: bundle.meta?.targetAtBats ?? 20,
    pitchCount,
    gameTitles: (bundle.games || []).slice(0, 5).map((g) => g.title),
    storage: 'filesystem',
  };
}

// —— Supabase ——

async function dbLoadSchedule() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('weekly_challenge_assignments').select('*');
  if (error) throw new Error(error.message);
  const assignments = {};
  for (const row of data || []) {
    assignments[row.week_id] = {
      bundleId: row.bundle_id,
      assignedAt: row.assigned_at,
      assignedBy: row.assigned_by,
    };
  }
  return { version: 1, assignments };
}

async function dbSaveAssignment(weekId, bundleId, assignedBy = 'admin') {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('weekly_challenge_assignments').upsert(
    {
      week_id: weekId,
      bundle_id: bundleId,
      assigned_at: new Date().toISOString(),
      assigned_by: assignedBy,
    },
    { onConflict: 'week_id' }
  );
  if (error) throw new Error(error.message);
}

async function dbRemoveAssignment(weekId) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('weekly_challenge_assignments').delete().eq('week_id', weekId);
  if (error) throw new Error(error.message);
}

async function dbLoadCatalog() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('weekly_challenge_bundles')
    .select('id, label, meta, created_at, updated_at, games')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => {
    const games = row.games || [];
    const pitchCount = games.reduce((s, g) => s + (g.pitches?.length || 0), 0);
    return {
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      challengeWeekId: row.meta?.challengeWeekId || null,
      gameCount: games.length,
      targetAtBats: row.meta?.targetAtBats ?? 20,
      pitchCount,
      gameTitles: games.slice(0, 5).map((g) => g.title),
      storage: 'supabase',
    };
  });
}

async function dbLoadBundle(bundleId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('weekly_challenge_bundles')
    .select('*')
    .eq('id', bundleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    label: data.label,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    meta: data.meta,
    games: data.games,
  };
}

async function dbSaveBundle(bundle) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const row = {
    id: bundle.id,
    label: bundle.label || bundle.id,
    meta: bundle.meta || {},
    games: bundle.games || [],
    updated_at: now,
  };
  const { error } = await supabase.from('weekly_challenge_bundles').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  return summarizeBundle({ ...bundle, updatedAt: now });
}

async function dbDeleteBundle(bundleId) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('weekly_challenge_bundles').delete().eq('id', bundleId);
  if (error) throw new Error(error.message);
}

// —— Public API ——

export async function loadSchedule() {
  const mode = getStorageMode();
  if (mode === 'supabase') return dbLoadSchedule();
  if (mode === 'filesystem') return fsLoadSchedule();
  return fsLoadSchedule();
}

export async function saveScheduleAssignment(weekId, bundleId, assignedBy = 'admin') {
  const mode = getStorageMode();
  if (mode === 'none') {
    throw new Error(
      'Cannot save assignments: production filesystem is read-only. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  if (mode === 'supabase') {
    await dbSaveAssignment(weekId, bundleId, assignedBy);
    const schedule = await dbLoadSchedule();
    schedule.assignments[weekId] = {
      bundleId,
      assignedAt: new Date().toISOString(),
      assignedBy,
    };
    return schedule;
  }
  const schedule = fsLoadSchedule();
  schedule.assignments[weekId] = {
    bundleId,
    assignedAt: new Date().toISOString(),
    assignedBy,
  };
  fsSaveSchedule(schedule);
  return schedule;
}

export async function removeScheduleAssignment(weekId) {
  const mode = getStorageMode();
  if (mode === 'supabase') {
    await dbRemoveAssignment(weekId);
    return dbLoadSchedule();
  }
  const schedule = fsLoadSchedule();
  delete schedule.assignments[weekId];
  fsSaveSchedule(schedule);
  return schedule;
}

export async function loadCatalog() {
  const mode = getStorageMode();
  if (mode === 'supabase') {
    const db = await dbLoadCatalog();
    if (db.length) return db;
  }
  return fsLoadCatalog().map((b) => ({ ...b, storage: 'filesystem' }));
}

export async function loadBundle(bundleId) {
  const mode = getStorageMode();
  if (mode === 'supabase') {
    const b = await dbLoadBundle(bundleId);
    if (b) return b;
  }
  return fsLoadBundle(bundleId);
}

export async function saveBundle(bundle) {
  const mode = getStorageMode();
  if (mode === 'none') {
    throw new Error(
      'Cannot save bundle: server filesystem is read-only (EROFS). Add Supabase credentials to the deployment environment.'
    );
  }
  bundle.updatedAt = new Date().toISOString();
  if (!bundle.createdAt) bundle.createdAt = bundle.updatedAt;

  if (mode === 'supabase') {
    const summary = await dbSaveBundle(bundle);
    if (canWriteFilesystem()) {
      try {
        fsSaveBundle(bundle);
        const catalog = fsLoadCatalog().filter((b) => b.id !== bundle.id);
        catalog.unshift(summarizeBundle(bundle));
        fsSaveCatalogSummaries(catalog);
      } catch {
        /* optional local mirror */
      }
    }
    return summary;
  }

  fsSaveBundle(bundle);
  const catalog = fsLoadCatalog().filter((b) => b.id !== bundle.id);
  const summary = summarizeBundle(bundle);
  catalog.unshift(summary);
  fsSaveCatalogSummaries(catalog);
  return summary;
}

export async function deleteBundle(bundleId) {
  const used = await getWeeksUsingBundle(bundleId);
  if (used.length) {
    throw new Error(`Bundle is assigned to: ${used.join(', ')}. Unassign first.`);
  }
  const mode = getStorageMode();
  if (mode === 'supabase') await dbDeleteBundle(bundleId);
  if (mode === 'filesystem' || canWriteFilesystem()) {
    try {
      fsDeleteBundle(bundleId);
      const catalog = fsLoadCatalog().filter((b) => b.id !== bundleId);
      fsSaveCatalogSummaries(catalog);
      const schedule = fsLoadSchedule();
      let changed = false;
      for (const [weekId, a] of Object.entries(schedule.assignments || {})) {
        if (a?.bundleId === bundleId) {
          delete schedule.assignments[weekId];
          changed = true;
        }
      }
      if (changed) fsSaveSchedule(schedule);
    } catch {
      /* ignore fs cleanup errors */
    }
  }
}

export async function getWeeksUsingBundle(bundleId) {
  const schedule = await loadSchedule();
  return Object.entries(schedule.assignments || {})
    .filter(([, a]) => a?.bundleId === bundleId)
    .map(([weekId]) => weekId);
}

export function attachUsedByWeeks(catalog, schedule) {
  return catalog.map((b) => ({
    ...b,
    usedByWeeks: Object.entries(schedule.assignments || {})
      .filter(([, a]) => a?.bundleId === b.id)
      .map(([weekId]) => weekId)
      .sort((a, b) => b.localeCompare(a)),
  }));
}
