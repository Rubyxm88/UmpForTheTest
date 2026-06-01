#!/usr/bin/env node
/**
 * Push Supabase service role (and URL) to Vercel production + preview.
 * Reads from .env.local or process.env.SUPABASE_SERVICE_ROLE_KEY
 *
 *   npm run vercel:env
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SUPABASE_URL } from './lib/supabase-project.mjs';
import { loadLocalEnv } from './lib/env-file.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

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

function setEnv(name, value, target) {
  console.log(`Setting ${name} on Vercel (${target})…`);
  runVercel(['env', 'add', name, target, '--force'], `${value}\n`);
}

const local = loadLocalEnv(root);
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || local.SUPABASE_SERVICE_ROLE_KEY || '';
const url = process.env.SUPABASE_URL || local.SUPABASE_URL || SUPABASE_URL;

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

for (const target of ['production', 'preview']) {
  setEnv('SUPABASE_SERVICE_ROLE_KEY', serviceKey, target);
  setEnv('SUPABASE_URL', url, target);
}

console.log('\nDone. Redeploy: npx vercel deploy --prod');
console.log('Verify: npm run vercel:supabase');
