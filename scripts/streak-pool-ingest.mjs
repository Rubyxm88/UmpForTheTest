#!/usr/bin/env node
/**
 * Upload streak pool ABs from src/data/streak_pool.js into Supabase streak_at_bats.
 *
 *   npm run streak-pool:ingest
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSupabaseAdmin } from '../api/_lib/supabase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      if (!(key in process.env)) process.env[key] = t.slice(eq + 1).trim();
    }
  }
}

loadEnv();

function toRow(ab) {
  const atBatNum =
    typeof ab.atBatNumber === 'number'
      ? ab.atBatNumber
      : Number(ab.pitches?.[0]?.at_bat_index ?? ab.pitches?.[0]?.at_bat_number) || 0;

  return {
    id: ab.id,
    game_pk: ab.gamePk ?? ab.game_pk ?? null,
    at_bat_number: atBatNum,
    difficulty: ab.difficulty ?? 50,
    tier: ab.tier ?? 2,
    eligible: ab.eligible !== false,
    reject_reason: ab.rejectReason || ab.reject_reason || null,
    metrics: ab.metrics || {},
    pitcher: ab.pitcher || null,
    batter: ab.batter || null,
    game_title: ab.gameTitle || ab.game_title || null,
    film_room_url: ab.filmRoomUrl || ab.film_room_url || null,
    ump_scorecard_url: ab.umpScorecardUrl || ab.ump_scorecard_url || null,
    pitches: ab.pitches || [],
  };
}

async function main() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }

  const { STREAK_POOL_ABS } = await import('../src/data/streak_pool.js');
  const rows = STREAK_POOL_ABS.map(toRow);
  const batchSize = 100;
  let upserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from('streak_at_bats').upsert(chunk, { onConflict: 'id' });
    if (error) {
      console.error('Ingest failed:', error.message);
      if (/does not exist|relation/i.test(error.message)) {
        console.error('Apply migration: supabase/migrations/20260601000000_streak_pool.sql');
      }
      process.exit(1);
    }
    upserted += chunk.length;
    console.log(`Upserted ${upserted}/${rows.length}`);
  }

  console.log(`Done — ${upserted} at-bats in streak_at_bats`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
