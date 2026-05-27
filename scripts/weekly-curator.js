#!/usr/bin/env node

/**
 * Weekly Curator Script for UmpForTheTest
 *
 * Fetches 5 high-quality MLB games from the past 7 days via the MLB Stats API,
 * parses pitch-by-pitch data into the app's format, writes the weekly challenge
 * data file, and resets the weekly leaderboard on KVDB.
 *
 * Requirements: Node.js 20+ (uses native fetch)
 * No external dependencies.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MLB_SCHEDULE_URL = 'https://statsapi.mlb.com/api/v1/schedule';
const MLB_GAME_FEED_URL = 'https://statsapi.mlb.com/api/v1.1/game';
const JSONBIN_WEEKLY_URL = 'https://jsonbin-zeta.vercel.app/api/bins/1xVZn2Uhux';
const OUTPUT_PATH = path.resolve(__dirname, '..', 'src', 'data', 'weekly_challenge.js');
const TARGET_GAME_COUNT = 5;

// Umpire call code → S/B mapping
const CALL_MAP = {
  C: 'S', // Called strike
  S: 'S', // Swinging strike
  F: 'S', // Foul
  X: 'S', // In play
  B: 'B', // Ball
  W: 'B', // Called ball (wide)
  H: 'B', // Hit by pitch
};

// Swing call codes (batter swung)
const SWING_CODES = new Set(['S', 'F', 'X']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function fetchJSON(url, label) {
  console.log(`  ↳ Fetching ${label}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${label}: ${url}`);
  }
  return res.json();
}

/**
 * Determine the ABS (automated ball-strike) call from pitch coordinates
 * and the batter's strike zone. The rule-book zone is 17 inches (≈ 0.7083 ft)
 * wide, centred at x = 0. We use the standard radius of the zone
 * (half-plate + ball-radius ≈ 0.83 ft).
 */
function computeAbsCall(pX, pZ, szTop, szBot) {
  if (pX == null || pZ == null || szTop == null || szBot == null) return null;
  const HALF_ZONE_WIDTH = 0.83; // feet — half plate width + ball radius
  const inX = Math.abs(pX) <= HALF_ZONE_WIDTH;
  const inZ = pZ >= szBot && pZ <= szTop;
  return inX && inZ ? 'S' : 'B';
}

/**
 * Map an at-bat result event to a swing_hit_type value.
 */
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
  // Fallback – strikeout swinging doesn't reach here normally, but safety net
  return eventType.toUpperCase();
}

/**
 * Determine swing_outcome for the final pitch of an at-bat.
 */
function swingOutcome(eventType) {
  if (!eventType) return null;
  const e = eventType.toLowerCase().replace(/[_\s]/g, '');

  // Hits
  if (
    e.includes('single') ||
    e.includes('double') ||
    e.includes('triple') ||
    e.includes('homerun') ||
    e === 'home_run'
  ) {
    return 'HIT';
  }

  // Strikeout (swinging) → WHIFF
  if (e.includes('strikeout')) return 'WHIFF';

  // Everything else in play → OUT (including fielder's choice, double play, etc.)
  return 'OUT';
}

/**
 * Generate a simple historical blurb for a pitch.
 */
function generateBlurb(pitcher, batter, pitchType, callCode, isLastPitch, eventType, resultEvent) {
  const isSwing = SWING_CODES.has(callCode);

  if (!isLastPitch || !isSwing) {
    // Not last pitch or not a swing — describe the called pitch
    if (isSwing && callCode === 'F') {
      return `${batter} fouls off a ${pitchType} from ${pitcher}.`;
    }
    if (isSwing && callCode === 'S') {
      return `${batter} swings and misses at a ${pitchType} from ${pitcher}.`;
    }
    // Called ball or strike
    const callWord = CALL_MAP[callCode] === 'S' ? 'STRIKE' : 'BALL';
    return `${pitcher} throws a ${pitchType}. ${batter} takes for a called ${callWord}.`;
  }

  // Last pitch of the at-bat, batter swung
  const outcome = swingOutcome(resultEvent);
  if (outcome === 'HIT') {
    const hitLabel = mapHitType(resultEvent) || 'hit';
    return `${batter} swings and connects on ${pitcher}'s ${pitchType} for a ${hitLabel.toLowerCase()}!`;
  }
  if (outcome === 'WHIFF') {
    return `${batter} whiffs on a nasty ${pitcher} ${pitchType} for strike three!`;
  }
  // OUT
  const hitType = mapHitType(resultEvent);
  const outLabel = hitType ? hitType.toLowerCase() : 'out';
  return `${batter} swings at a ${pitchType} and hits a routine ${outLabel} for an OUT.`;
}

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

/**
 * Step 1 — Fetch the MLB schedule for the past 7 days and pick 5 diverse games.
 */
async function fetchScheduleAndPickGames() {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - 1); // yesterday
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6); // 7-day window

  const url =
    `${MLB_SCHEDULE_URL}?sportId=1` +
    `&startDate=${formatDate(startDate)}` +
    `&endDate=${formatDate(endDate)}` +
    `&hydrate=linescore`;

  console.log(`\n📅 Fetching MLB schedule: ${formatDate(startDate)} → ${formatDate(endDate)}`);
  const schedule = await fetchJSON(url, 'schedule');

  // Collect all completed regular-season games
  const completedGames = [];
  for (const dateEntry of schedule.dates || []) {
    for (const game of dateEntry.games || []) {
      if (
        game.status?.abstractGameState === 'Final' &&
        game.gameType === 'R' // Regular season
      ) {
        completedGames.push({
          gamePk: game.gamePk,
          date: dateEntry.date,
          away: game.teams?.away?.team?.name || 'Away',
          home: game.teams?.home?.team?.name || 'Home',
          awayId: game.teams?.away?.team?.id,
          homeId: game.teams?.home?.team?.id,
          venue: game.venue?.name || '',
          totalRuns:
            (game.teams?.away?.score || 0) + (game.teams?.home?.score || 0),
        });
      }
    }
  }

  console.log(`  Found ${completedGames.length} completed regular-season games.`);

  if (completedGames.length === 0) {
    throw new Error('No completed games found in the past 7 days. Is it the offseason?');
  }

  // Sort by total runs descending (prefer higher-scoring / more exciting games)
  completedGames.sort((a, b) => b.totalRuns - a.totalRuns);

  // Greedily pick games with team diversity
  const picked = [];
  const usedTeamIds = new Set();

  for (const game of completedGames) {
    if (picked.length >= TARGET_GAME_COUNT) break;
    // Prefer games where neither team has been used yet
    if (!usedTeamIds.has(game.awayId) && !usedTeamIds.has(game.homeId)) {
      picked.push(game);
      usedTeamIds.add(game.awayId);
      usedTeamIds.add(game.homeId);
    }
  }

  // If we still need more games, relax the diversity constraint
  if (picked.length < TARGET_GAME_COUNT) {
    for (const game of completedGames) {
      if (picked.length >= TARGET_GAME_COUNT) break;
      if (!picked.some((p) => p.gamePk === game.gamePk)) {
        picked.push(game);
      }
    }
  }

  console.log(`  Selected ${picked.length} games for this week's challenge.`);
  for (const g of picked) {
    console.log(`    • ${g.away} @ ${g.home} (${g.date}) — gamePk ${g.gamePk}`);
  }

  return picked;
}

/**
 * Step 2 — For each game, fetch play-by-play and parse pitches.
 */
async function fetchAndParseGame(gameMeta, gameIndex) {
  const { gamePk, date, away, home, venue } = gameMeta;
  const url = `${MLB_GAME_FEED_URL}/${gamePk}/feed/live`;

  console.log(`\n⚾ Game ${gameIndex + 1}: ${away} @ ${home} (${date})`);
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

      // Skip pitches without a valid call mapping
      if (!(callCode in CALL_MAP)) continue;

      const szTop = pitchData.strikeZoneTop ?? 3.4;
      const szBot = pitchData.strikeZoneBottom ?? 1.6;
      const pX = coords.pX;
      const pZ = coords.pZ;

      const isSwing = SWING_CODES.has(callCode);
      const isLastPitchOfAB = j === lastPitchIndex;

      // swing_outcome and swing_hit_type only on the last pitch of an at-bat
      let pitchSwingOutcome = null;
      let pitchSwingHitType = null;

      if (isLastPitchOfAB && isSwing) {
        pitchSwingOutcome = swingOutcome(resultEventType || resultEvent);
        pitchSwingHitType = mapHitType(resultEventType || resultEvent);
      }

      // Determine score and situation at time of pitch
      const countBefore = pe.count || {};
      const outs = countBefore.outs ?? 0;

      // Runners — use the play-level runners info for the pitch
      const runnersBefore = [0, 0, 0];
      const playRunners = play.runners || [];
      // Use movement.start to determine who was on base at pitch time
      for (const r of playRunners) {
        const startBase = r.movement?.start;
        if (startBase === '1B') runnersBefore[0] = 1;
        if (startBase === '2B') runnersBefore[1] = 1;
        if (startBase === '3B') runnersBefore[2] = 1;
      }

      // Score at the time — from the play.result or about
      const scoreAway = play.result?.awayScore ?? 0;
      const scoreHome = play.result?.homeScore ?? 0;

      const absCall = computeAbsCall(pX, pZ, szTop, szBot);

      const blurb = generateBlurb(
        pitcher,
        batter,
        details.type?.description || 'Pitch',
        callCode,
        isLastPitchOfAB,
        resultEventType || resultEvent,
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
        score_away: scoreAway,
        score_home: scoreHome,
        outs,
        runners: runnersBefore,
      });
    }
  }

  console.log(`  ✅ Parsed ${pitches.length} pitches from ${allPlays.length} at-bats.`);

  return {
    id: `game_${gameIndex + 1}`,
    title: `${away} vs. ${home}`,
    description: `${formatDisplayDate(date)}. ${venue}.`,
    film_room_url: `https://www.mlb.com/video/game/${gamePk}`,
    ump_scorecard_url: `https://umpscorecards.com/single_game/?game_id=${gamePk}`,
    pitches,
  };
}

/**
 * Step 3 — Write the data file.
 */
function writeDataFile(games) {
  const today = new Date();
  const resetDate = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const totalPitches = games.reduce((sum, g) => sum + g.pitches.length, 0);

  const header = [
    '/**',
    ` * Weekly Challenge Datasets — ${games.length} Curated MLB Games of Critical At-Bats`,
    ` * Reset Date: ${resetDate}`,
    ' * Each game includes complete at-bats with full Statcast trajectory parameters,',
    ' * swing details, narrative blurbs, Film Room URLs, and UmpScorecard URLs.',
    ` * Auto-generated by scripts/weekly-curator.js — ${totalPitches} total pitches`,
    ' */',
    '',
  ].join('\n');

  const json = JSON.stringify(games, null, 2);
  const fileContent = `${header}export const WEEKLY_CHALLENGE_DATA = ${json};\n`;

  fs.writeFileSync(OUTPUT_PATH, fileContent, 'utf-8');
  console.log(`\n📝 Wrote ${games.length} games (${totalPitches} pitches) to ${OUTPUT_PATH}`);
}

/**
 * Step 4 — Reset the weekly leaderboard on KVDB.
 */
async function resetLeaderboard() {
  console.log('\n🏆 Resetting weekly leaderboard on JSONBin...');
  try {
    const res = await fetch(JSONBIN_WEEKLY_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    });
    if (!res.ok) {
      console.error(`  ⚠️  JSONBin responded with HTTP ${res.status}: ${await res.text()}`);
    } else {
      console.log('  ✅ Weekly leaderboard reset successfully.');
    }
  } catch (err) {
    // Don't fail the whole pipeline if JSONBin is unreachable
    console.error(`  ⚠️  Failed to reset leaderboard: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  UmpForTheTest — Weekly Challenge Curator');
  console.log('═══════════════════════════════════════════════════════');

  try {
    // 1. Fetch schedule & pick games
    const gameMetas = await fetchScheduleAndPickGames();

    // 2. Fetch & parse each game sequentially (be kind to the API)
    const games = [];
    for (let i = 0; i < gameMetas.length; i++) {
      const game = await fetchAndParseGame(gameMetas[i], i);
      games.push(game);

      // Small delay between requests to avoid hammering the API
      if (i < gameMetas.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // 3. Write data file
    writeDataFile(games);

    // 4. Reset leaderboard
    await resetLeaderboard();

    console.log('\n✅ Weekly curator completed successfully!');
    console.log('═══════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error(`\n❌ Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
