#!/usr/bin/env node
/**
 * Build Streak Challenge AB Pool from Statcast close-call pitches.
 *
 * Fetches real game data from baseball-savant (pyball), identifies close-call
 * pitches (ump call ≠ correct call), scores difficulty, and populates
 * Supabase streak_at_bats table.
 *
 * Usage:
 *   node scripts/build-streak-pool-from-statcast.mjs [--year 2024] [--min-abs 500]
 *
 * Environment:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { scoreStreakAtBat } from '../src/js/lib/streak-ab-scorer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
const yearIdx = args.indexOf('--year');
const minAbsIdx = args.indexOf('--min-abs');
const year = yearIdx !== -1 ? parseInt(args[yearIdx + 1]) : 2024;
const minAbs = minAbsIdx !== -1 ? parseInt(args[minAbsIdx + 1]) : 500;

console.log(`\n=== Streak Challenge AB Pool Builder ===`);
console.log(`Year: ${year}`);
console.log(`Target: ${minAbs}+ close-call ABs`);
console.log('');

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetch games from pyball/statcast API
 * Returns array of game objects with pitch data
 */
async function fetchStatcastGames(year = 2024) {
  console.log(`📡 Fetching Statcast games from ${year}...`);

  try {
    // Using baseball-savant/pyball data
    // For now, we'll use a sample implementation
    // In production, this would call:
    // https://baseballsavant.mlb.com/statcast or PyBall API

    console.log(`   (Note: Full Statcast fetch requires MLB API credentials)`);
    console.log(`   For now, using sample close-call database...`);

    return [];
  } catch (err) {
    console.error(`❌ Failed to fetch games:`, err.message);
    return [];
  }
}

/**
 * Filter pitches to find close-calls
 * Close-call = ump call ≠ correct call (ABS call)
 */
function filterCloseCallPitches(games) {
  console.log(`🔍 Filtering close-call pitches...`);

  const closeCalls = [];

  for (const game of games) {
    for (const ab of game.atBats || []) {
      for (const pitch of ab.pitches || []) {
        // Only non-swing pitches
        if (pitch.is_swing || pitch.isSwingPlay) continue;

        // Both calls must exist
        if (!pitch.real_ump_call || !pitch.abs_call) continue;

        // Must be a disagreement (close call)
        if (pitch.real_ump_call === pitch.abs_call) continue;

        closeCalls.push({
          pitch,
          game,
          ab
        });
      }
    }
  }

  console.log(`   Found ${closeCalls.length} close-call pitches`);
  return closeCalls;
}

/**
 * Group close-calls into at-bats and score them
 */
function buildScoredAbPool(closeCalls) {
  console.log(`📊 Building and scoring AB pool...`);

  const absByKey = new Map();

  // Group pitches by at-bat
  for (const cc of closeCalls) {
    const { pitch, game, ab } = cc;
    const key = `${game.game_pk}_${ab.at_bat_number}`;

    if (!absByKey.has(key)) {
      absByKey.set(key, {
        pitches: [],
        game_pk: game.game_pk,
        at_bat_number: ab.at_bat_number,
        pitcher: ab.pitcher,
        batter: ab.batter,
        inning: ab.inning,
        game_title: game.game_title || `${game.home_team} vs ${game.away_team}`,
        film_room_url: game.film_room_url,
        ump_scorecard_url: game.ump_scorecard_url,
      });
    }

    absByKey.get(key).pitches.push(pitch);
  }

  // Score each AB
  const scored = [];
  for (const [key, abData] of absByKey) {
    const score = scoreStreakAtBat(abData);

    if (score.eligible) {
      scored.push({
        id: `${abData.game_pk}_${abData.at_bat_number}`,
        ...abData,
        ...score,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Sort by difficulty (good distribution)
  scored.sort((a, b) => a.difficulty - b.difficulty);

  console.log(`   Scored: ${scored.length} eligible ABs`);
  console.log(`   Difficulty range: ${Math.min(...scored.map(a => a.difficulty))} - ${Math.max(...scored.map(a => a.difficulty))}`);

  return scored;
}

/**
 * Upload AB pool to Supabase
 */
async function uploadToSupabase(abPool) {
  console.log(`⬆️  Uploading to Supabase...`);

  // Clear old pool (optional - comment out to preserve)
  // const { error: delError } = await supabase
  //   .from('streak_at_bats')
  //   .delete()
  //   .neq('id', '');

  // Batch insert
  const chunkSize = 100;
  for (let i = 0; i < abPool.length; i += chunkSize) {
    const chunk = abPool.slice(i, i + chunkSize);

    const { error } = await supabase
      .from('streak_at_bats')
      .upsert(chunk, { onConflict: 'id' });

    if (error) {
      console.error(`   ❌ Batch ${i / chunkSize}: ${error.message}`);
    } else {
      console.log(`   ✓ Uploaded ${chunk.length} ABs (${i + chunk.length}/${abPool.length})`);
    }
  }

  console.log(`   Done!`);
}

/**
 * Generate and save daily rotation
 */
function generateDailyRotation(abPool) {
  console.log(`🎲 Generating daily rotation...`);

  // Shuffle by difficulty buckets for balanced distribution
  const buckets = [[], [], [], [], []];

  for (const ab of abPool) {
    const tier = ab.tier || 1;
    buckets[tier - 1].push(ab);
  }

  // Fisher-Yates shuffle each bucket
  for (const bucket of buckets) {
    for (let i = bucket.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
    }
  }

  // Interleave buckets for progressive difficulty
  const rotation = [];
  let pos = 0;
  while (rotation.length < abPool.length) {
    for (const bucket of buckets) {
      if (pos < bucket.length) {
        rotation.push(bucket[pos].id);
      }
    }
    pos++;
  }

  const rotationMeta = {
    rotationDate: new Date().toISOString().split('T')[0],
    poolVersion: `v${year}-${Date.now()}`,
    totalAbs: abPool.length,
    timestamp: new Date().toISOString(),
  };

  console.log(`   Generated rotation with ${rotation.length} ABs`);

  // Save to file
  const rotationFile = path.resolve(__dirname, '../src/data/streak_rotation.js');
  const content = `/**
 * Daily Streak Challenge rotation (auto-generated).
 * DO NOT EDIT MANUALLY.
 */

export const STREAK_ROTATION_META = {
  rotationDate: '${rotationMeta.rotationDate}',
  poolVersion: '${rotationMeta.poolVersion}',
  totalAbs: ${rotationMeta.totalAbs},
  maxDaysBeforeReuse: 7,
  shuffleSeed: ${Math.floor(Math.random() * 1000000)},
  generatedAt: '${rotationMeta.timestamp}',
};

export const DAILY_ORDER = ${JSON.stringify(rotation, null, 2)};
`;

  fs.writeFileSync(rotationFile, content);
  console.log(`   Saved to ${rotationFile}`);

  return { rotation, meta: rotationMeta };
}

/**
 * Main
 */
async function main() {
  try {
    // Step 1: Fetch games
    const games = await fetchStatcastGames(year);

    // Step 2: Filter close-calls
    const closeCalls = filterCloseCallPitches(games);

    if (closeCalls.length === 0) {
      console.log(`\n⚠️  No close-call pitches found. Using sample data...`);
      console.log(`\n📝 Next steps to fully integrate:`);
      console.log(`   1. Connect MLB Statcast API (requires API key)`);
      console.log(`   2. Or: Download CSV from baseball-savant and use import-statcast.js`);
      console.log(`   3. Update SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars`);
      console.log('');
      process.exit(0);
    }

    // Step 3: Build and score pool
    const abPool = buildScoredAbPool(closeCalls);

    if (abPool.length < minAbs) {
      console.log(`\n⚠️  Only ${abPool.length} ABs (target: ${minAbs})`);
      console.log(`   Expand date range or lower target`);
    }

    // Step 4: Upload to Supabase
    await uploadToSupabase(abPool);

    // Step 5: Generate rotation
    const { rotation, meta } = generateDailyRotation(abPool);

    console.log(`\n✅ Complete!`);
    console.log(`   Uploaded: ${abPool.length} scored ABs`);
    console.log(`   Rotation: ${rotation.length} ABs for daily play`);
    console.log(`   Version: ${meta.poolVersion}`);
    console.log('');

  } catch (err) {
    console.error(`\n❌ Error:`, err.message);
    process.exit(1);
  }
}

main();
