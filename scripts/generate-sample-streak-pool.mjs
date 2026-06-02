#!/usr/bin/env node
/**
 * Generate realistic sample Streak Challenge AB pool for testing.
 *
 * Creates 500+ close-call ABs with realistic difficulty distribution
 * and uploads to Supabase for immediate testing.
 *
 * Usage:
 *   node scripts/generate-sample-streak-pool.mjs [--count 500]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
const countIdx = args.indexOf('--count');
const poolSize = countIdx !== -1 ? parseInt(args[countIdx + 1]) : 500;

console.log(`\n=== Sample Streak Challenge AB Pool Generator ===`);
console.log(`Generating ${poolSize} realistic close-call ABs...`);
console.log('');

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Sample data
const PITCHERS = [
  'Sandy Alcantara', 'Kyle Schwarber', 'Sonny Gray', 'Blake Snell',
  'Jacob deGrom', 'Clayton Kershaw', 'Zack Wheeler', 'Max Scherzer',
  'Juan Soto', 'Aaron Judge', 'Mike Trout', 'Jose Ramirez',
  'Francisco Lindor', 'Nolan Arenado', 'Mookie Betts', 'Christian Yelich'
];

const BATTERS = [
  'Mike Trout', 'Juan Soto', 'Aaron Judge', 'Jose Ramirez', 'Francisco Lindor',
  'Nolan Arenado', 'Mookie Betts', 'Christian Yelich', 'Fernando Tatis Jr',
  'George Springer', 'Kyle Schwarber', 'Austin Riley', 'Kyle Tucker',
  'Corey Seager', 'Freddie Freeman', 'Bryce Harper'
];

const TEAMS = [
  'NYY', 'LAD', 'BOS', 'NYM', 'PHI', 'ATL', 'WSH', 'MIA',
  'CHC', 'MIL', 'STL', 'CIN', 'PIT', 'SFG', 'SD', 'LAA'
];

/**
 * Generate realistic pitch data with physics
 */
function generatePitch(difficulty = 50) {
  const releaseX = (Math.random() - 0.5) * 3;
  const releaseY = 2.3 + Math.random() * 0.3;
  const releaseZ = 5.5 + Math.random() * 1;

  // More borderline for high difficulty
  const distFromCenter = difficulty < 50 ? Math.random() * 1.5 : Math.random() * 0.5;
  const angle = Math.random() * Math.PI * 2;
  const plateX = Math.cos(angle) * distFromCenter;
  const plateZ = 2.2 + Math.random() * 1.2;

  const vx0 = (Math.random() - 0.5) * 4 - 10;
  const vy0 = -145 - Math.random() * 20;
  const vz0 = 12 + Math.random() * 8;

  const ax = (Math.random() - 0.5) * 10;
  const ay = 32.2; // Gravity
  const az = (Math.random() - 0.5) * 10;

  const szTop = 3.4 + Math.random() * 0.2;
  const szBot = 1.5 + Math.random() * 0.3;

  // 50/50 chance ump gets it right
  const absCall = Math.abs(plateX) < 0.84 && plateZ > szBot && plateZ < szTop ? 'S' : 'B';
  const umpCall = Math.random() > 0.5 ? absCall : (absCall === 'S' ? 'B' : 'S');

  return {
    pitch_type: ['FF', 'SL', 'CU', 'CH', 'FC'][Math.floor(Math.random() * 5)],
    speed_mph: 85 + Math.random() * 15,
    release_pos_x: releaseX,
    release_pos_y: releaseY,
    release_pos_z: releaseZ,
    vx0,
    vy0,
    vz0,
    ax,
    ay,
    az,
    sz_top: szTop,
    sz_bot: szBot,
    plate_x: plateX,
    plate_z: plateZ,
    real_ump_call: umpCall,
    abs_call: absCall,
    is_swing: false,
    is_critical: Math.random() > 0.8,
  };
}

/**
 * Generate realistic AB with multiple pitches
 */
function generateAtBat(index, difficulty) {
  const numPitches = 2 + Math.floor(Math.random() * 4);
  const pitches = [];

  for (let i = 0; i < numPitches; i++) {
    pitches.push(generatePitch(difficulty));
  }

  const pitcher = PITCHERS[Math.floor(Math.random() * PITCHERS.length)];
  const batter = BATTERS[Math.floor(Math.random() * BATTERS.length)];
  const homeTeam = TEAMS[Math.floor(Math.random() * TEAMS.length)];
  const awayTeam = TEAMS[Math.floor(Math.random() * TEAMS.length)];

  const gamePk = Math.floor(Math.random() * 1000000) + 600000;

  return {
    id: `sample_${gamePk}_${index}`,
    game_pk: gamePk,
    at_bat_number: index,
    pitcher,
    batter,
    inning: 1 + Math.floor(Math.random() * 8),
    is_top: Math.random() > 0.5,
    game_title: `${awayTeam} @ ${homeTeam}`,
    pitches,
    difficulty,
    tier: Math.ceil(difficulty / 20),
    eligible: true,
    reject_reason: null,
    metrics: {
      pitchCount: numPitches,
      takenCount: numPitches,
      borderlineCount: Math.floor(Math.random() * (numPitches + 1)),
      criticalCount: Math.random() > 0.7 ? 1 : 0,
      minEdgeFt: (Math.random() * 0.15).toFixed(3),
    },
  };
}

/**
 * Main
 */
async function main() {
  try {
    console.log(`📊 Generating ${poolSize} ABs with realistic difficulty distribution...`);

    // Create ABs with distribution skewed toward higher difficulty
    const abPool = [];
    const difficultyValues = [];

    for (let i = 0; i < poolSize; i++) {
      // Exponential bias toward higher difficulty
      const t = i / poolSize;
      const baseDifficulty = 15 + 75 * (1 - Math.exp(-t * 3));
      const jitter = (Math.random() - 0.5) * 20;
      const difficulty = Math.max(10, Math.min(95, Math.round(baseDifficulty + jitter)));

      const ab = generateAtBat(i, difficulty);
      abPool.push(ab);
      difficultyValues.push(difficulty);
    }

    // Calculate distribution stats
    const avgDifficulty = Math.round(difficultyValues.reduce((a, b) => a + b) / poolSize);
    const minDifficulty = Math.min(...difficultyValues);
    const maxDifficulty = Math.max(...difficultyValues);

    console.log(`   Average difficulty: ${avgDifficulty}`);
    console.log(`   Range: ${minDifficulty} - ${maxDifficulty}`);

    // Difficulty tier breakdown
    const tierCounts = [0, 0, 0, 0, 0];
    for (const diff of difficultyValues) {
      const tier = Math.ceil(diff / 20);
      tierCounts[tier - 1]++;
    }
    console.log(`   Tier breakdown:`);
    for (let i = 0; i < 5; i++) {
      console.log(`      Tier ${i + 1} (${i * 20 + 1}-${(i + 1) * 20}): ${tierCounts[i]} ABs`);
    }

    console.log(`\n⬆️  Uploading to Supabase...`);

    // Clear existing pool
    const { error: delError } = await supabase
      .from('streak_at_bats')
      .delete()
      .like('id', 'sample_%');

    if (delError && delError.code !== 'PGRST116') {
      console.warn(`   Warning: Could not clear old samples: ${delError.message}`);
    }

    // Batch upload
    const chunkSize = 50;
    for (let i = 0; i < abPool.length; i += chunkSize) {
      const chunk = abPool.slice(i, i + chunkSize);

      const { error } = await supabase
        .from('streak_at_bats')
        .insert(chunk);

      if (error) {
        console.error(`   ❌ Batch ${Math.floor(i / chunkSize)}: ${error.message}`);
        if (error.details) console.error(`      ${error.details}`);
      } else {
        process.stdout.write(`\r   ✓ Uploaded ${Math.min(i + chunkSize, abPool.length)}/${poolSize}`);
      }
    }
    console.log('');

    console.log(`\n✅ Sample pool created!`);
    console.log(`   Total ABs: ${poolSize}`);
    console.log(`   Next: Build production data from Statcast`);
    console.log('');

  } catch (err) {
    console.error(`\n❌ Error:`, err.message);
    process.exit(1);
  }
}

main();
