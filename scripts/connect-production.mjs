#!/usr/bin/env node
/**
 * One-shot production connector: Supabase schema check → Vercel env → Vercel verify → live API probe.
 *
 *   npm run connect:prod
 *
 * Prerequisites: .env.local with SUPABASE_SERVICE_ROLE_KEY (for DB check + vercel:env)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './lib/env-file.mjs';
import { VERCEL_PROJECT_NAME } from './lib/supabase-project.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function runNpm(script, extraArgs = []) {
  const r = spawnSync('npm', ['run', script, '--', ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: true,
  });
  return r.status === 0;
}

function loadProductionUrl() {
  const env = loadLocalEnv(root);
  if (env.PRODUCTION_URL?.trim()) return env.PRODUCTION_URL.trim().replace(/\/$/, '');

  const checkPath = join(root, '.env.vercel.check');
  if (existsSync(checkPath)) {
    const text = readFileSync(checkPath, 'utf8');
    const m = text.match(/^VERCEL_URL=(\S+)/m);
    if (m) return `https://${m[1].replace(/^https?:\/\//, '')}`;
  }
  return `https://${VERCEL_PROJECT_NAME}.vercel.app`;
}

async function probeLiveApi(baseUrl) {
  const url = `${baseUrl}/api/weekly-challenge`;
  console.log(`\nProbing ${url} …`);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 200) {
      console.log(`  weekly-challenge: ok (week ${body.weekId || body.meta?.weekId || '?'})`);
      return true;
    }
    if (res.status === 404) {
      console.log(`  weekly-challenge: 404 — no assignment for current week (assign in /admin)`);
      return true;
    }
    if (res.status === 503) {
      console.log('  weekly-challenge: 503 — Supabase env missing on Vercel (run npm run vercel:env)');
      return false;
    }
    console.log(`  weekly-challenge: HTTP ${res.status}`, body.error || '');
    return res.status < 500;
  } catch (err) {
    console.log(`  weekly-challenge: fetch failed (${err.message})`);
    return false;
  }
}

console.log('=== UmpSim production connector ===\n');

const migrateStatus = spawnSync('npm', ['run', 'supabase:migrate'], {
  cwd: root,
  encoding: 'utf8',
  shell: true,
});
if (migrateStatus.status !== 0) {
  console.log('\nFix Supabase schema first, then re-run connect:prod\n');
  process.exit(1);
}

const env = loadLocalEnv(root);
const hasKey =
  env.SUPABASE_SERVICE_ROLE_KEY &&
  !/your_service_role|placeholder|changeme/i.test(env.SUPABASE_SERVICE_ROLE_KEY);

if (hasKey) {
  console.log('\n--- Vercel env (production + preview) ---\n');
  if (!runNpm('vercel:env')) {
    process.exit(1);
  }
} else {
  console.log('\nSkip vercel:env — add SUPABASE_SERVICE_ROLE_KEY to .env.local\n');
}

console.log('\n--- Vercel env verify ---\n');
if (!runNpm('vercel:supabase')) {
  process.exit(1);
}

const baseUrl = loadProductionUrl();
const apiOk = await probeLiveApi(baseUrl);

console.log(`
--- Done ---

${apiOk ? 'Production looks wired.' : 'Check Vercel env and redeploy: npx vercel deploy --prod'}

Admin: ${baseUrl}/admin
Assign weekly challenge after migrations if players see bundle_fallback.
`);

process.exit(apiOk ? 0 : 1);
