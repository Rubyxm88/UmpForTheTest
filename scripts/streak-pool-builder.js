#!/usr/bin/env node
/**
 * Build the Streak Challenge AB pool manifest + embedded AB payloads.
 *
 * Usage:
 *   node scripts/streak-pool-builder.js [--output src/data/streak_pool.js]
 *
 * Reads weekly_challenge.js, daily_challenge.js, orioles_game.js.
 * Scores each AB; writes STREAK_POOL_META + STREAK_POOL_ABS for client bundle.
 *
 * At 20k+ ABs, switch to --manifest-only and store pitches in Supabase (see migration).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreStreakAtBat } from '../src/js/lib/streak-ab-scorer.js';
import { WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META } from '../src/data/weekly_challenge.js';
import { DAILY_CHALLENGE_DATA } from '../src/data/daily_challenge.js';
import { ORIOLES_GAME_DATA } from '../src/data/orioles_game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.resolve(__dirname, '../src/data/streak_pool.js');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--output');
const OUTPUT_PATH = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : DEFAULT_OUTPUT;
const manifestOnly = args.includes('--manifest-only');

function groupPitchesByAtBat(pitches, gameMeta = {}) {
  if (!pitches?.length) return [];
  const abs = [];
  let current = [];
  let currentKey = null;

  for (const pitch of pitches) {
    const atBatIdx = pitch.at_bat_index ?? pitch.at_bat_number;
    const isTop = pitch.is_top !== undefined ? pitch.is_top : pitch.isTop !== undefined ? pitch.isTop : true;
    const key =
      atBatIdx != null
        ? `ab_${atBatIdx}`
        : `${pitch.pitcher}_${pitch.batter}_${pitch.inning}_${isTop}`;

    if (currentKey === null) {
      currentKey = key;
      current.push(pitch);
    } else if (currentKey === key) {
      current.push(pitch);
    } else {
      abs.push(buildAbEntry(current, gameMeta, currentKey));
      currentKey = key;
      current = [pitch];
    }
  }
  if (current.length) abs.push(buildAbEntry(current, gameMeta, currentKey));
  return abs;
}

function buildAbEntry(pitches, gameMeta, key) {
  const first = pitches[0];
  let gamePk = gameMeta.gamePk || first.game_pk || first.gamePk || null;
  const filmUrl = gameMeta.film_room_url || gameMeta.filmRoomUrl || null;
  if (!gamePk && filmUrl) {
    const m = String(filmUrl).match(/\/game\/(\d+)/);
    if (m) gamePk = m[1];
  }
  const atBatNumber = first.at_bat_number ?? first.at_bat_index ?? key;
  const id = gamePk != null ? `${gamePk}_${atBatNumber}` : `local_${key}_${first.id ?? 0}`;

  return {
    id,
    gamePk,
    atBatNumber,
    gameTitle: gameMeta.title || null,
    filmRoomUrl: filmUrl,
    umpScorecardUrl: gameMeta.ump_scorecard_url || gameMeta.umpScorecardUrl || null,
    pitcher: first.pitcher,
    batter: first.batter,
    inning: first.inning,
    is_top: first.is_top !== undefined ? first.is_top : first.isTop,
    pitches,
  };
}

function collectSourceAbs() {
  const all = [];

  for (let i = 0; i < (WEEKLY_CHALLENGE_DATA || []).length; i++) {
    const game = WEEKLY_CHALLENGE_DATA[i];
    all.push(...groupPitchesByAtBat(game.pitches, {
      title: game.title,
      gamePk: game.gamePk ?? WEEKLY_CHALLENGE_META?.gamePks?.[i] ?? null,
      film_room_url: game.film_room_url,
      ump_scorecard_url: game.ump_scorecard_url,
    }));
  }

  const dailyPitches = DAILY_CHALLENGE_DATA?.pitches || (Array.isArray(DAILY_CHALLENGE_DATA) ? DAILY_CHALLENGE_DATA : []);
  if (dailyPitches.length) {
    all.push(
      ...groupPitchesByAtBat(dailyPitches, {
        title: DAILY_CHALLENGE_DATA.title,
        film_room_url: DAILY_CHALLENGE_DATA.film_room_url,
        ump_scorecard_url: DAILY_CHALLENGE_DATA.ump_scorecard_url,
      })
    );
  }

  if (ORIOLES_GAME_DATA?.length) {
    all.push(...groupPitchesByAtBat(ORIOLES_GAME_DATA, { title: 'Orioles Full Game' }));
  }

  return all;
}

function main() {
  const rawAbs = collectSourceAbs();
  const seen = new Set();
  const scored = [];
  const rejectCounts = {};

  for (const ab of rawAbs) {
    if (seen.has(ab.id)) continue;
    seen.add(ab.id);

    const result = scoreStreakAtBat(ab);
    if (!result.eligible) {
      rejectCounts[result.rejectReason] = (rejectCounts[result.rejectReason] || 0) + 1;
      continue;
    }

    const entry = {
      id: ab.id,
      gamePk: ab.gamePk,
      atBatNumber: ab.atBatNumber,
      gameTitle: ab.gameTitle,
      filmRoomUrl: ab.filmRoomUrl,
      umpScorecardUrl: ab.umpScorecardUrl,
      inning: ab.inning,
      is_top: ab.is_top,
      pitcher: ab.pitcher,
      batter: ab.batter,
      difficulty: result.difficulty,
      tier: result.tier,
      eligible: true,
      metrics: result.metrics,
      lastUsedDate: null,
    };

    if (!manifestOnly) {
      entry.pitches = ab.pitches;
    }

    scored.push(entry);
  }

  scored.sort((a, b) => a.difficulty - b.difficulty);

  const tierCounts = [0, 0, 0, 0, 0, 0];
  for (const ab of scored) tierCounts[ab.tier]++;

  const meta = {
    version: 1,
    builtAt: new Date().toISOString(),
    totalAbs: scored.length,
    sourceAbs: rawAbs.length,
    tierCounts: { 1: tierCounts[1], 2: tierCounts[2], 3: tierCounts[3], 4: tierCounts[4], 5: tierCounts[5] },
    rejectCounts,
    manifestOnly,
  };

  console.log('Streak pool build:');
  console.log(`  Source ABs: ${rawAbs.length}`);
  console.log(`  Eligible:   ${scored.length}`);
  console.log(`  Rejected:   ${JSON.stringify(rejectCounts)}`);
  console.log(`  Tiers:      ${JSON.stringify(meta.tierCounts)}`);

  const js = `/**
 * Streak Challenge AB pool — generated by scripts/streak-pool-builder.js
 * Do not edit manually. Rebuild after bulk Statcast ingest or weekly refresh.
 */
export const STREAK_POOL_META = ${JSON.stringify(meta, null, 2)};

export const STREAK_POOL_ABS = ${JSON.stringify(scored, null, 2)};
`;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, js, 'utf-8');
  console.log(`Written: ${OUTPUT_PATH}`);
}

main();
