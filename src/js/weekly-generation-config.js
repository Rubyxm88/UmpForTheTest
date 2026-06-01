/**
 * Weekly challenge generation criteria — shared by admin UI, curator, and playlist builder.
 */

export const WEEKLY_GENERATION_CONFIG_VERSION = 1;

/** @typedef {'high_scoring_diverse' | 'manual_pks' | 'latest_final'} GameSelectionMode */

export const DEFAULT_WEEKLY_GENERATION_CONFIG = {
  version: WEEKLY_GENERATION_CONFIG_VERSION,
  label: 'Default weekly mix',
  /** ISO week to publish for (null = current week at generate time). */
  scheduleForWeekId: null,
  games: {
    count: 5,
    lookbackDays: 7,
    selectionMode: 'high_scoring_diverse',
    manualGamePks: [],
    minTotalRuns: 0,
    gameTypes: ['R'],
  },
  playlist: {
    targetAtBats: 20,
    borderlineRatio: 0.5,
    borderlineEdgeThresholdFt: 0.15,
    shuffleSeed: null,
    perGameCap: null,
    minPitchesPerAb: 1,
    maxPitchesPerAb: null,
    prioritizeLateInning: false,
  },
  filters: {
    requireCalledPitch: true,
    requireCompleteAb: true,
    excludeSwingOnlyAbs: false,
    minCalledPitchesPerAb: 1,
  },
};

/**
 * @param {unknown} raw
 * @returns {typeof DEFAULT_WEEKLY_GENERATION_CONFIG}
 */
export function normalizeWeeklyGenerationConfig(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_WEEKLY_GENERATION_CONFIG));
  if (!raw || typeof raw !== 'object') return base;

  const src = /** @type {Record<string, unknown>} */ (raw);
  if (typeof src.label === 'string') base.label = src.label;
  if (src.scheduleForWeekId === null || typeof src.scheduleForWeekId === 'string') {
    base.scheduleForWeekId = src.scheduleForWeekId;
  }

  if (src.games && typeof src.games === 'object') {
    const g = /** @type {Record<string, unknown>} */ (src.games);
    if (Number.isFinite(Number(g.count))) base.games.count = Math.max(1, Math.min(10, Number(g.count)));
    if (Number.isFinite(Number(g.lookbackDays))) {
      base.games.lookbackDays = Math.max(1, Math.min(30, Number(g.lookbackDays)));
    }
    if (g.selectionMode === 'high_scoring_diverse' || g.selectionMode === 'manual_pks' || g.selectionMode === 'latest_final') {
      base.games.selectionMode = g.selectionMode;
    }
    if (Array.isArray(g.manualGamePks)) {
      base.games.manualGamePks = g.manualGamePks.map((pk) => Number(pk)).filter((pk) => Number.isFinite(pk) && pk > 0);
    }
    if (Number.isFinite(Number(g.minTotalRuns))) base.games.minTotalRuns = Math.max(0, Number(g.minTotalRuns));
    if (Array.isArray(g.gameTypes) && g.gameTypes.length) {
      base.games.gameTypes = g.gameTypes.map((t) => String(t));
    }
  }

  if (src.playlist && typeof src.playlist === 'object') {
    const p = /** @type {Record<string, unknown>} */ (src.playlist);
    if (Number.isFinite(Number(p.targetAtBats))) {
      base.playlist.targetAtBats = Math.max(5, Math.min(200, Number(p.targetAtBats)));
    }
    if (Number.isFinite(Number(p.borderlineRatio))) {
      base.playlist.borderlineRatio = Math.max(0, Math.min(1, Number(p.borderlineRatio)));
    }
    if (Number.isFinite(Number(p.borderlineEdgeThresholdFt))) {
      base.playlist.borderlineEdgeThresholdFt = Math.max(0.05, Math.min(0.5, Number(p.borderlineEdgeThresholdFt)));
    }
    if (p.shuffleSeed === null || Number.isFinite(Number(p.shuffleSeed))) {
      base.playlist.shuffleSeed = p.shuffleSeed === null ? null : Number(p.shuffleSeed);
    }
    if (p.perGameCap === null || Number.isFinite(Number(p.perGameCap))) {
      base.playlist.perGameCap = p.perGameCap === null ? null : Math.max(1, Number(p.perGameCap));
    }
    if (Number.isFinite(Number(p.minPitchesPerAb))) {
      base.playlist.minPitchesPerAb = Math.max(1, Number(p.minPitchesPerAb));
    }
    if (p.maxPitchesPerAb === null || Number.isFinite(Number(p.maxPitchesPerAb))) {
      base.playlist.maxPitchesPerAb = p.maxPitchesPerAb === null ? null : Math.max(1, Number(p.maxPitchesPerAb));
    }
    if (typeof p.prioritizeLateInning === 'boolean') base.playlist.prioritizeLateInning = p.prioritizeLateInning;
  }

  if (src.filters && typeof src.filters === 'object') {
    const f = /** @type {Record<string, unknown>} */ (src.filters);
    if (typeof f.requireCalledPitch === 'boolean') base.filters.requireCalledPitch = f.requireCalledPitch;
    if (typeof f.excludeSwingOnlyAbs === 'boolean') base.filters.excludeSwingOnlyAbs = f.excludeSwingOnlyAbs;
    if (typeof f.requireCompleteAb === 'boolean') base.filters.requireCompleteAb = f.requireCompleteAb;
    if (Number.isFinite(Number(f.minCalledPitchesPerAb))) {
      base.filters.minCalledPitchesPerAb = Math.max(0, Number(f.minCalledPitchesPerAb));
    }
  }

  return base;
}

/**
 * Merge saved generation config into exported weekly meta for the client bundle.
 * @param {object} meta
 * @param {ReturnType<typeof normalizeWeeklyGenerationConfig>} config
 */
export function attachGenerationToMeta(meta, config) {
  const playlist = config.playlist;
  return {
    ...meta,
    targetAtBats: playlist.targetAtBats,
    borderlineRatio: playlist.borderlineRatio,
    borderlineEdgeThresholdFt: playlist.borderlineEdgeThresholdFt,
    perGameCap: playlist.perGameCap,
    generation: config,
  };
}

/**
 * Resolve playlist options from bundle meta + optional live config.
 * @param {object} meta
 * @param {ReturnType<typeof normalizeWeeklyGenerationConfig>} [config]
 */
export function resolvePlaylistOptions(meta, config) {
  const cfg = config || normalizeWeeklyGenerationConfig(meta?.generation);
  const playlist = cfg.playlist;
  return {
    targetAtBats: meta?.targetAtBats ?? playlist.targetAtBats,
    borderlineRatio: meta?.borderlineRatio ?? playlist.borderlineRatio,
    borderlineEdgeThresholdFt: meta?.borderlineEdgeThresholdFt ?? playlist.borderlineEdgeThresholdFt,
    shuffleSeed: meta?.shuffleSeed ?? playlist.shuffleSeed,
    perGameCap: meta?.perGameCap ?? playlist.perGameCap,
    minPitchesPerAb: playlist.minPitchesPerAb,
    maxPitchesPerAb: playlist.maxPitchesPerAb,
    prioritizeLateInning: playlist.prioritizeLateInning,
    filters: cfg.filters,
  };
}

export const GENERATION_CRITERIA_CATALOG = [
  {
    id: 'targetAtBats',
    group: 'playlist',
    label: 'Target at-bats',
    description: 'How many ABs players see this week (playlist length).',
    type: 'number',
    min: 5,
    max: 200,
  },
  {
    id: 'borderlineRatio',
    group: 'playlist',
    label: 'Borderline mix',
    description: 'Share of ABs with at least one edge pitch (0 = all routine, 1 = all borderline).',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    id: 'borderlineEdgeThresholdFt',
    group: 'playlist',
    label: 'Borderline edge (ft)',
    description: 'Distance to zone edge that counts as borderline.',
    type: 'number',
    min: 0.05,
    max: 0.5,
    step: 0.01,
  },
  {
    id: 'perGameCap',
    group: 'playlist',
    label: 'Max ABs per game',
    description: 'Cap how many playlist ABs can come from one game (empty = no cap).',
    type: 'number',
    min: 1,
    max: 50,
    optional: true,
  },
  {
    id: 'prioritizeLateInning',
    group: 'playlist',
    label: 'Favor late innings',
    description: 'Prefer 7th inning and later when filling the playlist.',
    type: 'boolean',
  },
  {
    id: 'gameCount',
    group: 'games',
    label: 'Games in bundle',
    description: 'How many full games to fetch and store in the weekly file.',
    type: 'number',
    min: 1,
    max: 10,
  },
  {
    id: 'lookbackDays',
    group: 'games',
    label: 'Schedule lookback (days)',
    description: 'Window to search for completed MLB games.',
    type: 'number',
    min: 1,
    max: 30,
  },
  {
    id: 'selectionMode',
    group: 'games',
    label: 'Game selection',
    description: 'How games are picked from the schedule.',
    type: 'select',
    options: [
      { value: 'high_scoring_diverse', label: 'High scoring + team diversity' },
      { value: 'latest_final', label: 'Most recent finals' },
      { value: 'manual_pks', label: 'Manual game PK list' },
    ],
  },
  {
    id: 'minTotalRuns',
    group: 'games',
    label: 'Minimum total runs',
    description: 'Skip low-scoring games when auto-selecting.',
    type: 'number',
    min: 0,
    max: 30,
  },
  {
    id: 'requireCalledPitch',
    group: 'filters',
    label: 'Require called pitch',
    description: 'Each AB must include at least one taken pitch (B/S call).',
    type: 'boolean',
  },
  {
    id: 'excludeSwingOnlyAbs',
    group: 'filters',
    label: 'Exclude swing-only ABs',
    description: 'Drop ABs where every pitch was a swing event.',
    type: 'boolean',
  },
];
