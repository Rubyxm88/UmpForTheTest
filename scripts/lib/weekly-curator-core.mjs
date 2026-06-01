/**
 * Parameterized weekly challenge curator — used by CLI and admin API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getIsoWeekKey,
  getMondayDateString,
  isoWeekToShuffleSeed,
} from '../../src/js/challenge-utils.js';
import {
  attachGenerationToMeta,
  normalizeWeeklyGenerationConfig,
} from '../../src/js/weekly-generation-config.js';
import { summarizePlaylistBuild } from '../../src/js/weekly-playlist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, '../../src/data/weekly_challenge.js');

const MLB_SCHEDULE_URL = 'https://statsapi.mlb.com/api/v1/schedule';
const MLB_GAME_FEED_URL = 'https://statsapi.mlb.com/api/v1.1/game';

const CALL_MAP = { C: 'S', S: 'S', F: 'S', X: 'S', B: 'B', W: 'B', H: 'B' };
const SWING_CODES = new Set(['S', 'F', 'X']);

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function fetchJSON(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${label}: ${url}`);
  return res.json();
}

function computeAbsCall(pX, pZ, szTop, szBot) {
  if (pX == null || pZ == null || szTop == null || szBot == null) return null;
  const HALF_ZONE_WIDTH = 0.83;
  const inX = Math.abs(pX) <= HALF_ZONE_WIDTH;
  const inZ = pZ >= szBot && pZ <= szTop;
  return inX && inZ ? 'S' : 'B';
}

function mapHitType(eventType) {
  if (!eventType) return null;
  const e = eventType.toLowerCase().replace(/[_\s]/g, '');
  if (e.includes('single')) return 'SINGLE';
  if (e.includes('double') && !e.includes('play')) return 'DOUBLE';
  if (e.includes('triple') && !e.includes('play')) return 'TRIPLE';
  if (e.includes('homerun') || e === 'home_run') return 'HOMERUN';
  if (e.includes('groundout') || e.includes('groundsout')) return 'GROUNDOUT';
  if (e.includes('flyout') || e.includes('fliesout')) return 'FLYOUT';
  if (e.includes('lineout') || e.includes('linesout')) return 'LINEOUT';
  if (e.includes('popout') || e.includes('popup')) return 'POPOUT';
  if (e.includes('fielderschoice') || e.includes('fielders_choice')) return 'FIELDERSCHOICE';
  if (e.includes('doubleplay') || e.includes('dp') || e.includes('grounded_into_double_play')) return 'GROUNDOUT';
  if (e.includes('sacfly') || e.includes('sac_fly')) return 'FLYOUT';
  if (e.includes('sacbunt') || e.includes('sac_bunt')) return 'GROUNDOUT';
  if (e.includes('forceout') || e.includes('force_out')) return 'GROUNDOUT';
  if (e.includes('error')) return 'ERROR';
  return eventType.toUpperCase();
}

function swingOutcome(eventType) {
  if (!eventType) return null;
  const e = eventType.toLowerCase().replace(/[_\s]/g, '');
  if (e.includes('single') || e.includes('double') || e.includes('triple') || e.includes('homerun') || e === 'home_run') {
    return 'HIT';
  }
  if (e.includes('strikeout')) return 'WHIFF';
  return 'OUT';
}

function generateBlurb(pitcher, batter, pitchType, callCode, isLastPitch, resultEvent) {
  const isSwing = SWING_CODES.has(callCode);
  if (!isLastPitch || !isSwing) {
    if (isSwing && callCode === 'F') return `${batter} fouls off a ${pitchType} from ${pitcher}.`;
    if (isSwing && callCode === 'S') return `${batter} swings and misses at a ${pitchType} from ${pitcher}.`;
    const callWord = CALL_MAP[callCode] === 'S' ? 'STRIKE' : 'BALL';
    return `${pitcher} throws a ${pitchType}. ${batter} takes for a called ${callWord}.`;
  }
  const outcome = swingOutcome(resultEvent);
  if (outcome === 'HIT') {
    const hitLabel = mapHitType(resultEvent) || 'hit';
    return `${batter} swings and connects on ${pitcher}'s ${pitchType} for a ${hitLabel.toLowerCase()}!`;
  }
  if (outcome === 'WHIFF') return `${batter} whiffs on a nasty ${pitcher} ${pitchType} for strike three!`;
  const hitType = mapHitType(resultEvent);
  const outLabel = hitType ? hitType.toLowerCase() : 'out';
  return `${batter} swings at a ${pitchType} and hits a routine ${outLabel} for an OUT.`;
}

async function fetchScheduleGames(config) {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (config.games.lookbackDays - 1));

  const url =
    `${MLB_SCHEDULE_URL}?sportId=1` +
    `&startDate=${formatDate(startDate)}` +
    `&endDate=${formatDate(endDate)}` +
    `&hydrate=linescore`;

  const schedule = await fetchJSON(url, 'schedule');
  const allowedTypes = new Set(config.games.gameTypes || ['R']);
  const completedGames = [];

  for (const dateEntry of schedule.dates || []) {
    for (const game of dateEntry.games || []) {
      if (game.status?.abstractGameState !== 'Final') continue;
      if (!allowedTypes.has(game.gameType)) continue;
      const totalRuns = (game.teams?.away?.score || 0) + (game.teams?.home?.score || 0);
      if (totalRuns < (config.games.minTotalRuns || 0)) continue;
      completedGames.push({
        gamePk: game.gamePk,
        date: dateEntry.date,
        away: game.teams?.away?.team?.name || 'Away',
        home: game.teams?.home?.team?.name || 'Home',
        awayId: game.teams?.away?.team?.id,
        homeId: game.teams?.home?.team?.id,
        venue: game.venue?.name || '',
        totalRuns,
      });
    }
  }

  return completedGames;
}

function pickGames(completedGames, config) {
  const targetCount = config.games.count;
  const mode = config.games.selectionMode;

  if (mode === 'manual_pks' && config.games.manualGamePks?.length) {
    const pkSet = new Set(config.games.manualGamePks.map(Number));
    const manual = completedGames.filter((g) => pkSet.has(g.gamePk));
    const ordered = config.games.manualGamePks
      .map((pk) => manual.find((g) => g.gamePk === Number(pk)))
      .filter(Boolean);
    if (ordered.length) return ordered.slice(0, targetCount);
  }

  if (mode === 'latest_final') {
    return completedGames
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.gamePk - a.gamePk)
      .slice(0, targetCount);
  }

  completedGames.sort((a, b) => b.totalRuns - a.totalRuns);
  const picked = [];
  const usedTeamIds = new Set();
  for (const game of completedGames) {
    if (picked.length >= targetCount) break;
    if (!usedTeamIds.has(game.awayId) && !usedTeamIds.has(game.homeId)) {
      picked.push(game);
      usedTeamIds.add(game.awayId);
      usedTeamIds.add(game.homeId);
    }
  }
  if (picked.length < targetCount) {
    for (const game of completedGames) {
      if (picked.length >= targetCount) break;
      if (!picked.some((p) => p.gamePk === game.gamePk)) picked.push(game);
    }
  }
  return picked.slice(0, targetCount);
}

async function fetchAndParseGame(gameMeta, gameIndex) {
  const { gamePk, date, away, home, venue } = gameMeta;
  const url = `${MLB_GAME_FEED_URL}/${gamePk}/feed/live`;
  const feed = await fetchJSON(url, `gamePk ${gamePk}`);
  const allPlays = feed?.liveData?.plays?.allPlays || [];
  const pitches = [];
  let pitchId = gameIndex * 10000 + 1;

  for (const play of allPlays) {
    const matchup = play.matchup || {};
    const pitcher = matchup.pitcher?.fullName || 'Unknown Pitcher';
    const batter = matchup.batter?.fullName || 'Unknown Batter';
    const pitcherHand = matchup.pitchHand?.code === 'L' ? 'LHP' : 'RHP';
    const batterHand = matchup.batSide?.code === 'L' ? 'LHB' : 'RHB';
    const aboutInning = play.about?.inning || 1;
    const isTop = play.about?.isTopInning ?? true;
    const resultEvent = play.result?.event || '';
    const resultEventType = play.result?.eventType || '';
    const events = play.playEvents || [];
    const pitchEvents = events.filter((e) => e.isPitch === true);
    const lastPitchIndex = pitchEvents.length - 1;

    for (let j = 0; j < pitchEvents.length; j++) {
      const pe = pitchEvents[j];
      const details = pe.details || {};
      const pitchData = pe.pitchData || {};
      const coords = pitchData.coordinates || {};
      const callCode = details.call?.code || '';
      if (!(callCode in CALL_MAP)) continue;

      const szTop = pitchData.strikeZoneTop ?? 3.4;
      const szBot = pitchData.strikeZoneBottom ?? 1.6;
      const pX = coords.pX;
      const pZ = coords.pZ;
      const isSwing = SWING_CODES.has(callCode);
      const isLastPitchOfAB = j === lastPitchIndex;
      let pitchSwingOutcome = null;
      let pitchSwingHitType = null;
      if (isLastPitchOfAB && isSwing) {
        pitchSwingOutcome = swingOutcome(resultEventType || resultEvent);
        pitchSwingHitType = mapHitType(resultEventType || resultEvent);
      }

      const countBefore = pe.count || {};
      const outs = countBefore.outs ?? 0;
      const runnersBefore = [0, 0, 0];
      for (const r of play.runners || []) {
        const startBase = r.movement?.start;
        if (startBase === '1B') runnersBefore[0] = 1;
        if (startBase === '2B') runnersBefore[1] = 1;
        if (startBase === '3B') runnersBefore[2] = 1;
      }

      const absCall = computeAbsCall(pX, pZ, szTop, szBot);
      const blurb = generateBlurb(
        pitcher,
        batter,
        details.type?.description || 'Pitch',
        callCode,
        isLastPitchOfAB,
        resultEventType || resultEvent
      );

      pitches.push({
        id: pitchId++,
        inning: aboutInning,
        is_top: isTop,
        pitcher,
        pitcher_hand: pitcherHand,
        batter,
        batter_hand: batterHand,
        pitch_type: details.type?.description || 'Unknown',
        speed_mph: pitchData.startSpeed != null ? Math.round(pitchData.startSpeed) : null,
        release_pos_x: coords.x0 ?? null,
        release_pos_y: coords.y0 ?? null,
        release_pos_z: coords.z0 ?? null,
        vx0: coords.vX0 ?? null,
        vy0: coords.vY0 ?? null,
        vz0: coords.vZ0 ?? null,
        ax: coords.aX ?? null,
        ay: coords.aY ?? null,
        az: coords.aZ ?? null,
        sz_top: szTop,
        sz_bot: szBot,
        real_ump_call: CALL_MAP[callCode],
        abs_call: absCall || CALL_MAP[callCode],
        is_critical: false,
        historical_blurb: blurb,
        is_swing: isSwing,
        swing_outcome: pitchSwingOutcome,
        swing_hit_type: pitchSwingHitType,
        score_away: play.result?.awayScore ?? 0,
        score_home: play.result?.homeScore ?? 0,
        outs,
        runners: runnersBefore,
      });
    }
  }

  return {
    id: `game_${gameIndex + 1}`,
    gamePk,
    title: `${away} vs. ${home}`,
    description: `${formatDisplayDate(date)}. ${venue}.`,
    film_room_url: `https://www.mlb.com/video/game/${gamePk}`,
    ump_scorecard_url: `https://umpscorecards.com/single_game/?game_id=${gamePk}`,
    pitches,
  };
}

export function buildWeeklyMeta(games, config, referenceDate = new Date()) {
  const weekId = config.scheduleForWeekId || getIsoWeekKey(referenceDate);
  const shuffleFromConfig = config.playlist.shuffleSeed;
  const shuffleSeed =
    shuffleFromConfig != null ? Number(shuffleFromConfig) : isoWeekToShuffleSeed(weekId);

  const baseMeta = {
    challengeWeekId: weekId,
    resetDate: getMondayDateString(referenceDate),
    gameCount: games.length,
    targetAtBats: config.playlist.targetAtBats,
    gamePks: games.map((g) => g.gamePk).filter(Boolean),
    shuffleSeed,
    borderlineRatio: config.playlist.borderlineRatio,
    borderlineEdgeThresholdFt: config.playlist.borderlineEdgeThresholdFt,
    perGameCap: config.playlist.perGameCap,
  };

  return attachGenerationToMeta(baseMeta, config);
}

export function formatWeeklyBundleFile(games, meta) {
  const totalPitches = games.reduce((sum, g) => sum + g.pitches.length, 0);
  const resetLabel = new Date(`${meta.resetDate}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const header = [
    '/**',
    ` * Weekly Challenge Datasets — ${games.length} Curated MLB Games`,
    ` * Reset Date: ${resetLabel}`,
    ` * Target playlist: ${meta.targetAtBats} at-bats`,
    ' * Auto-generated by scripts/lib/weekly-curator-core.mjs',
    ` * ${totalPitches} total pitches in bundle`,
    ' */',
    '',
    `export const WEEKLY_CHALLENGE_META = ${JSON.stringify(meta, null, 2)};`,
    '',
  ].join('\n');

  return `${header}export const WEEKLY_CHALLENGE_DATA = ${JSON.stringify(games, null, 2)};\n`;
}

export function writeWeeklyBundle(games, meta, outputPath = DEFAULT_OUTPUT_PATH) {
  const fileContent = formatWeeklyBundleFile(games, meta);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, fileContent, 'utf-8');
  return { outputPath, bytes: fileContent.length, totalPitches: games.reduce((s, g) => s + g.pitches.length, 0) };
}

/**
 * @param {import('../../src/js/weekly-generation-config.js').DEFAULT_WEEKLY_GENERATION_CONFIG} rawConfig
 * @param {{ delayMs?: number, maxGames?: number, log?: boolean }} [opts]
 */
export async function runWeeklyCurator(rawConfig, opts = {}) {
  const config = normalizeWeeklyGenerationConfig(rawConfig);
  const log = opts.log !== false;
  const delayMs = opts.delayMs ?? 1000;
  const maxGames = opts.maxGames ?? config.games.count;

  const completedGames = await fetchScheduleGames(config);
  if (!completedGames.length) {
    throw new Error('No completed games found for the configured window.');
  }

  const gameMetas = pickGames(completedGames, config).slice(0, maxGames);
  if (!gameMetas.length) {
    throw new Error('No games selected — check manual PKs or selection criteria.');
  }

  const games = [];
  for (let i = 0; i < gameMetas.length; i++) {
    if (log) console.log(`\n⚾ Game ${i + 1}/${gameMetas.length}: ${gameMetas[i].away} @ ${gameMetas[i].home}`);
    games.push(await fetchAndParseGame(gameMetas[i], i));
    if (i < gameMetas.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const meta = buildWeeklyMeta(games, config);
  const playlistStats = summarizePlaylistBuild(games, meta, config);

  return { config, meta, games, gameMetas, playlistStats };
}

export function loadConfigFromFile(configPath) {
  const text = fs.readFileSync(configPath, 'utf8');
  return normalizeWeeklyGenerationConfig(JSON.parse(text));
}

export const CONFIG_PATH = path.resolve(__dirname, '../../src/data/weekly_generation_config.json');
