/**
 * At-bat completeness helpers for weekly challenge build + gameplay.
 */

const SWING_END_OUTCOMES = new Set(['HIT', 'OUT', 'WHIFF']);

/**
 * Replay count state from stored pitch data (no user calls).
 * @param {object[]} pitches
 */
export function replaySourceAbCount(pitches = []) {
  let balls = 0;
  let strikes = 0;
  for (const pitch of pitches) {
    if (pitch.is_swing) {
      const outcome = pitch.swing_outcome;
      if (outcome === 'WHIFF') strikes += 1;
      else if (outcome === 'FOUL' && strikes < 2) strikes += 1;
      else if (outcome === 'HIT' || outcome === 'OUT') {
        return { balls, strikes, terminated: true, reason: outcome };
      }
    } else if (pitch.real_ump_call === 'S') {
      strikes += 1;
    } else if (pitch.real_ump_call === 'B') {
      balls += 1;
    }
    if (balls >= 4) {
      return { balls, strikes, terminated: true, reason: 'walk' };
    }
    if (strikes >= 3) {
      return { balls, strikes, terminated: true, reason: 'strikeout' };
    }
  }
  return { balls, strikes, terminated: false, reason: null };
}

/** True when pitch sequence ends in a real plate appearance result. */
export function isSourceAbTerminated(pitches = []) {
  if (!pitches?.length) return false;
  const last = pitches[pitches.length - 1];
  if (last?.ab_event || last?.ab_event_type) return true;
  if (last?.is_swing && SWING_END_OUTCOMES.has(last.swing_outcome)) return true;
  return replaySourceAbCount(pitches).terminated;
}

export function formatSourceAbCountLine(pitches = []) {
  const { balls, strikes, terminated } = replaySourceAbCount(pitches);
  const suffix = terminated ? '' : ' · incomplete';
  return `${balls}-${strikes}${suffix}`;
}

/**
 * @param {object} lastPitch
 * @param {{ balls?: number, strikes?: number }} [liveCount]
 */
export function formatWeeklyAbOutcomeText(lastPitch, liveCount = {}) {
  if (!lastPitch) return 'AT-BAT COMPLETE';
  const batter = (lastPitch.batter || 'Batter').toUpperCase();
  const event = (lastPitch.ab_event || '').trim();
  const type = (lastPitch.ab_event_type || '').toLowerCase();
  const eventLower = event.toLowerCase();

  if (lastPitch.ab_outcome_short === 'HR') return `${batter} HOME RUN!`;
  if (lastPitch.ab_outcome_short === '1B') return `${batter} SINGLES!`;
  if (lastPitch.ab_outcome_short === '2B') return `${batter} DOUBLES!`;
  if (lastPitch.ab_outcome_short === '3B') return `${batter} TRIPLES!`;
  if (event) return `${batter} — ${event.toUpperCase()}`;

  if (type.includes('strikeout') || eventLower.includes('strikeout')) return `${batter} STRIKEOUT!`;
  if (type.includes('walk') || eventLower.includes('walk') || type.includes('intent_walk')) {
    return `${batter} WALKS!`;
  }
  if (type === 'home_run' || eventLower.includes('home run')) return `${batter} HOME RUN!`;
  if (type === 'single' || eventLower === 'single') return `${batter} SINGLES!`;
  if (type === 'double' || eventLower === 'double') return `${batter} DOUBLES!`;
  if (type === 'triple' || eventLower === 'triple') return `${batter} TRIPLES!`;
  if (type.includes('hit_by_pitch') || eventLower.includes('hit by pitch')) {
    return `${batter} HIT BY PITCH!`;
  }
  if (type.includes('field_out') || type.includes('force_out') || type.includes('grounded_into')) {
    return `${batter} OUT`;
  }

  if (lastPitch.is_swing) {
    if (lastPitch.swing_outcome === 'HIT' && lastPitch.swing_hit_type) {
      return `${batter} HITS A ${String(lastPitch.swing_hit_type).toUpperCase()}!`;
    }
    if (lastPitch.swing_outcome === 'OUT' && lastPitch.swing_hit_type) {
      return `${batter} OUT (${String(lastPitch.swing_hit_type).toUpperCase()})`;
    }
    if (lastPitch.swing_outcome === 'WHIFF') return `${batter} STRIKEOUT!`;
  }

  const balls = liveCount.balls ?? lastPitch.count_balls;
  const strikes = liveCount.strikes ?? lastPitch.count_strikes;
  if (strikes >= 3) return `${batter} STRIKEOUT!`;
  if (balls >= 4) return `${batter} WALKS!`;

  return 'AT-BAT COMPLETE';
}

export function summarizeSourceAb(pitches = []) {
  const last = pitches[pitches.length - 1];
  const countLine = formatSourceAbCountLine(pitches);
  const complete = isSourceAbTerminated(pitches);
  const outcome = complete ? formatWeeklyAbOutcomeText(last) : null;
  return { countLine, complete, outcome };
}
