/**
 * POST /api/streak-telemetry — record streak play events (logged-in users).
 * Body: { event: 'ab_served'|'pitch'|'ab_completed'|'session_end', ... }
 */

import { sendJson, readJsonBody } from './_lib/http.js';
import { getHandleFromRequest } from './_lib/session.js';
import { getSupabaseAdmin } from './_lib/supabase.js';
import {
  recordStreakAbServed,
  recordStreakPitch,
  recordStreakAbCompleted,
  recordStreakSessionEnd,
} from '../scripts/lib/streak-analytics.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const handle = getHandleFromRequest(req);
  if (!handle) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  if (!getSupabaseAdmin()) {
    sendJson(res, 503, { error: 'Analytics storage not configured' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const event = body.event;

    if (event === 'ab_served') {
      await recordStreakAbServed(body.abId, handle);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (event === 'pitch') {
      await recordStreakPitch(body.abId, { correct: Boolean(body.correct) });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (event === 'ab_completed') {
      await recordStreakAbCompleted(body.abId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (event === 'session_end') {
      const row = await recordStreakSessionEnd(handle, {
        dateKey: body.dateKey,
        startedAt: body.startedAt,
        correctStreak: body.correctStreak,
        absPlayed: body.absPlayed,
        pitchesCalled: body.pitchesCalled,
        correctPitches: body.correctPitches,
        usedAbIds: body.usedAbIds || [],
        meta: body.meta || {},
      });
      sendJson(res, 200, { ok: true, sessionId: row.id });
      return;
    }

    sendJson(res, 400, { error: `Unknown event: ${event}` });
  } catch (err) {
    console.error('streak-telemetry:', err);
    const msg = /does not exist|relation/i.test(err.message || '')
      ? 'Streak analytics tables missing — apply Supabase migrations.'
      : err.message || 'Telemetry failed';
    sendJson(res, 500, { error: msg });
  }
}
