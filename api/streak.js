/**
 * Streak pool (GET) + telemetry (POST) — one serverless function.
 */
import { sendJson } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mod = await import('./_handlers/streak/pool.js');
    return mod.default(req, res);
  }

  if (req.method === 'POST') {
    const mod = await import('./_handlers/streak/telemetry.js');
    return mod.default(req, res);
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}
