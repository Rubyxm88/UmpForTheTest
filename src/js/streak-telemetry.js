/**
 * Fire-and-forget streak telemetry to /api/streak-telemetry (logged-in only).
 */

let streakSessionStartedAt = null;
let streakSessionId = null;

/** Stable per-session id; lets the server dedupe session_end writes idempotently. */
function generateSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function markStreakSessionStart() {
  streakSessionStartedAt = new Date().toISOString();
  streakSessionId = generateSessionId();
}

/** Current stable session id (null before a session starts). */
export function getStreakSessionId() {
  return streakSessionId;
}

export function streakTelemetry(event, payload = {}) {
  if (!localStorage.getItem('ump_username')) return;
  fetch('/api/streak', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, ...payload }),
  }).catch(() => {});
}

export function streakTelemetryAbServed(abId) {
  streakTelemetry('ab_served', { abId });
}

export function streakTelemetryPitch(abId, correct) {
  streakTelemetry('pitch', { abId, correct });
}

export function streakTelemetryAbCompleted(abId) {
  streakTelemetry('ab_completed', { abId });
}

export function streakTelemetrySessionEnd({
  dateKey,
  correctStreak,
  absPlayed,
  pitchesCalled,
  correctPitches,
  usedAbIds,
}) {
  streakTelemetry('session_end', {
    dateKey,
    sessionId: streakSessionId,
    startedAt: streakSessionStartedAt,
    correctStreak,
    absPlayed,
    pitchesCalled,
    correctPitches,
    usedAbIds: [...(usedAbIds || [])],
  });
  streakSessionStartedAt = null;
  streakSessionId = null;
}
