#!/usr/bin/env node
/**
 * Verify Supabase schema (service role) and optionally push migrations via CLI.
 *
 *   npm run supabase:migrate          # check tables + list local migrations
 *   npm run supabase:migrate -- --push   # npx supabase db push (requires link + login)
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL,
  SUPABASE_PROJECT_REF,
  REQUIRED_TABLES,
  OPTIONAL_TABLES,
} from './lib/supabase-project.mjs';
import { loadLocalEnv } from './lib/env-file.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const push = process.argv.includes('--push');

function migrationNameFromFile(filename) {
  const m = filename.match(/^\d+_(.+)\.sql$/);
  return m ? m[1] : filename;
}

function listLocalMigrations() {
  const dir = join(root, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, name: migrationNameFromFile(f) }));
}

async function checkTables(env) {
  const serviceKey =
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() || env.SUPABASE_SECRET_KEY?.trim() || '';
  if (!serviceKey || /your_service_role|placeholder|changeme/i.test(serviceKey)) {
    console.log('Skip table check — add SUPABASE_SERVICE_ROLE_KEY to .env.local to verify remote schema\n');
    return { ok: null, missing: [], skipped: true };
  }

  const supabase = createClient(env.SUPABASE_URL?.trim() || SUPABASE_URL, serviceKey, {
    auth: { persistSession: false },
  });

  const missing = [];
  const optionalMissing = [];

  for (const table of REQUIRED_TABLES) {
    const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(0);
    if (error?.code === '42P01' || /does not exist|relation/i.test(error?.message || '')) {
      missing.push(table);
    } else if (error) {
      console.warn(`  warn ${table}: ${error.message}`);
    }
  }

  for (const table of OPTIONAL_TABLES) {
    const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(0);
    if (error?.code === '42P01' || /does not exist|relation/i.test(error?.message || '')) {
      optionalMissing.push(table);
    }
  }

  return { ok: missing.length === 0, missing, optionalMissing };
}

function runDbPush() {
  console.log('Running: npx supabase db push …\n');
  const r = spawnSync(
    'npx',
    ['--yes', 'supabase@latest', 'db', 'push', '--linked'],
    { cwd: root, encoding: 'utf8', stdio: 'inherit', shell: true }
  );
  if (r.status !== 0) {
    console.log(`
db push failed. Ensure:
  1. npx supabase login
  2. npx supabase link --project-ref ${SUPABASE_PROJECT_REF}
  3. Database password from Supabase dashboard (if prompted)

Or apply SQL manually in Supabase → SQL Editor from supabase/migrations/
`);
    process.exit(r.status || 1);
  }
}

console.log(`Supabase project: ${SUPABASE_PROJECT_REF}\n`);

const local = listLocalMigrations();
console.log('Local migrations:');
for (const { file, name } of local) {
  console.log(`  ${file}  (${name})`);
}
console.log('');

const env = loadLocalEnv(root);
const { ok, missing, optionalMissing } = await checkTables(env);

if (ok === null) {
  console.log('Remote schema: not verified (no service key locally)');
} else if (ok) {
  console.log('Required tables: ok');
} else {
  console.log('Missing required tables:', missing.join(', '));
  console.log('Apply migrations in supabase/migrations/ (see docs/SUPABASE_SETUP.md)\n');
}

if (optionalMissing?.length) {
  console.log('Optional v3 analytics tables missing:', optionalMissing.join(', '));
  console.log('  → apply 20260528210144_v3_challenge_analytics.sql if you need pitch_attempts analytics\n');
}

if (push) {
  if (!ok) {
    console.log('Pushing migrations to fix missing tables…\n');
  }
  runDbPush();
  const after = await checkTables(env);
  if (!after.ok) {
    console.error('\nStill missing after push:', after.missing.join(', '));
    process.exit(1);
  }
  console.log('\nMigrations applied (or already up to date).');
  process.exit(0);
}

if (ok === false) {
  console.log('Next: npm run supabase:migrate -- --push');
  console.log('  or paste SQL from supabase/migrations/ in the Supabase SQL Editor.\n');
  process.exit(1);
}

if (ok === null) {
  console.log('Remote (UmpSim3000) is already migrated if you use the hosted project.');
  console.log('Add .env.local key to verify, or: npm run connect:prod\n');
  process.exit(0);
}

console.log('Schema ready. Sync Vercel env: npm run vercel:env && npm run vercel:supabase\n');
process.exit(0);
