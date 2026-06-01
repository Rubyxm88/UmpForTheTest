/**
 * Read streak pool meta without importing the full streak_pool.js bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const META_JSON = path.resolve(__dirname, '../../src/data/streak_pool_meta.json');
const POOL_JS = path.resolve(__dirname, '../../src/data/streak_pool.js');

const FALLBACK = {
  version: 1,
  totalAbs: 0,
  manifestOnly: false,
  builtAt: null,
};

export function getStreakPoolMeta() {
  try {
    if (fs.existsSync(META_JSON)) {
      return { ...FALLBACK, ...JSON.parse(fs.readFileSync(META_JSON, 'utf8')) };
    }
  } catch {
    /* fall through */
  }

  try {
    if (!fs.existsSync(POOL_JS)) return { ...FALLBACK };
    const head = fs.readFileSync(POOL_JS, 'utf8').slice(0, 8192);
    const match = head.match(/export const STREAK_POOL_META = (\{[\s\S]*?\});/);
    if (match) {
      return { ...FALLBACK, ...Function(`"use strict"; return (${match[1]});`)() };
    }
  } catch {
    /* ignore */
  }

  return { ...FALLBACK };
}
