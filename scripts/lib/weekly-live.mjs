/**
 * Resolve the weekly challenge bundle assigned to an ISO week (Supabase or filesystem).
 */

import { getIsoWeekKey } from '../../api/_lib/period.js';
import { getStorageMode, loadBundle, loadSchedule } from './weekly-storage.mjs';

export async function getAssignedWeeklyBundle(weekId = getIsoWeekKey()) {
  const schedule = await loadSchedule();
  const assignment = schedule.assignments?.[weekId];
  if (!assignment?.bundleId) return null;

  const bundle = await loadBundle(assignment.bundleId);
  if (!bundle?.games?.length) return null;

  return {
    weekId,
    bundleId: bundle.id,
    label: bundle.label || bundle.id,
    meta: bundle.meta || {},
    games: bundle.games,
    assignedAt: assignment.assignedAt || null,
    assignedBy: assignment.assignedBy || null,
    storage: getStorageMode(),
    updatedAt: bundle.updatedAt || null,
  };
}
