/**
 * Fire-and-forget streak telemetry to /api/streak-telemetry (logged-in only).
 */

let streakSessionStartedAt = null;

export function markStreakSessionStart() {
  streakSessionStartedAt = new Date().toISOString();
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
    startedAt: streakSessionStartedAt,
    correctStreak,
    absPlayed,
    pitchesCalled,
    correctPitches,
    usedAbIds: [...(usedAbIds || [])],
  });
  streakSessionStartedAt = null;
}
