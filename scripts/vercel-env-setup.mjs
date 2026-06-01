#!/usr/bin/env node
/**
 * Push Supabase service role (and optional locals) to Vercel production.
 * Reads from .env.local or process.env.SUPABASE_SERVICE_ROLE_KEY
 *
 *   npm run vercel:env
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function runVercel(args, input) {
  const r = spawnSync('npx', ['--yes', 'vercel@latest', ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

const local = { ...loadEnvFile('.env.local'), ...loadEnvFile('.env') };
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || local.SUPABASE_SERVICE_ROLE_KEY || '';
const url = process.env.SUPABASE_URL || local.SUPABASE_URL || 'https://wrtwqfvicftxpduukzwm.supabase.co';

if (!serviceKey || /your_service_role|placeholder/i.test(serviceKey)) {
  console.error(`
Missing SUPABASE_SERVICE_ROLE_KEY.

1. Copy .env.example → .env.local
2. Paste the service_role key from:
   https://supabase.com/dashboard/project/wrtwqfvicftxpduukzwm/settings/api-keys
3. Run: npm run vercel:env
`);
  process.exit(1);
}

console.log('Setting SUPABASE_SERVICE_ROLE_KEY on Vercel (production)...');
runVercel(['env', 'add', 'SUPABASE_SERVICE_ROLE_KEY', 'production', '--force'], `${serviceKey}\n`);

if (!local.SUPABASE_URL) {
  console.log('Setting SUPABASE_URL on Vercel (production)...');
  runVercel(['env', 'add', 'SUPABASE_URL', 'production', '--force'], `${url}\n`);
}

console.log('Done. Redeploy: npx vercel --prod');
console.log('Or trigger a new deployment from the Vercel dashboard.');
