#!/usr/bin/env node
/**
 * Verify production Supabase env on Vercel (no marketplace integration).
 *
 *   npm run vercel:supabase
 *
 * To set keys (no Vercel plan upgrade):
 *   1. Paste service_role into .env.local
 *   2. npm run vercel:env
 *   3. npx vercel deploy --prod
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: true });
}

console.log('Checking Vercel production env for umpsim3000...\n');

const pull = run('npx', [
  '--yes',
  'vercel@latest',
  'env',
  'pull',
  '.env.vercel.check',
  '--environment=production',
  '--yes',
]);
if (pull.status !== 0) {
  console.log('Could not pull env. Run: npx vercel link');
  process.exit(1);
}

const text = readFileSync(join(root, '.env.vercel.check'), 'utf8');
const hasUrl = /SUPABASE_URL=\S+/.test(text);
const hasSecret =
  /SUPABASE_SERVICE_ROLE_KEY=\S+/.test(text) || /SUPABASE_SECRET_KEY=\S+/.test(text);

console.log('  SUPABASE_URL:', hasUrl ? 'ok' : 'missing');
console.log('  service key:', hasSecret ? 'ok' : 'missing');

if (hasUrl && hasSecret) {
  console.log('\nReady. Redeploy if you changed env recently: npx vercel deploy --prod');
  process.exit(0);
}

console.log(`
Still missing the service key.

1. https://supabase.com/dashboard/project/wrtwqfvicftxpduukzwm/settings/api-keys
2. Copy service_role → .env.local as SUPABASE_SERVICE_ROLE_KEY
3. npm run vercel:env
4. npx vercel deploy --prod

Do not use "vercel integration add supabase" — that provisions a new DB and may ask for a Vercel plan upgrade.
`);
process.exit(1);
