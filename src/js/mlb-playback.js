/**
 * Maps MLB Statcast pitch call codes → in-game swing / outcome playback (1:1 AB replay).
 */

const SWING_CALL_CODES = new Set(['S', 'F', 'L', 'X', 'D', 'E']);
const IN_PLAY_CALL_CODES = new Set(['X', 'D', 'E']);

export function isInPlayMlbCallCode(callCode) {
  return IN_PLAY_CALL_CODES.has(callCode);
}

export function isMlbSwingCallCode(callCode) {
  return SWING_CALL_CODES.has(callCode);
}

/**
 * Per-pitch playback flags from MLB call + plate-appearance result (terminal pitch only).
 */
export function mapPitchPlaybackFields(callCode, isLast, abResult, abEvent, details = null) {
  const desc = (details?.description || details?.call?.description || '').toLowerCase();
  const isSwing = isMlbSwingCallCode(callCode);

  if (!isSwing) {
    return {
      is_swing: false,
      playback_swing_outcome: null,
      playback_swing_hit_type: '',
    };
  }

  if (callCode === 'F') {
    const foulTip = desc.includes('foul tip');
    return {
      is_swing: true,
      playback_swing_outcome: 'FOUL',
      playback_swing_hit_type: foulTip ? 'FOUL TIP' : '',
    };
  }

  if (callCode === 'S') {
    return {
      is_swing: true,
      playback_swing_outcome: 'WHIFF',
      playback_swing_hit_type: '',
    };
  }

  if (IN_PLAY_CALL_CODES.has(callCode)) {
    const terminal = mapTerminalFromAbResult(abResult, abEvent);
    return {
      is_swing: true,
      playback_swing_outcome: terminal.outcome || 'OUT',
      playback_swing_hit_type: terminal.hitType || 'FLYOUT',
    };
  }

  if (callCode === 'L') {
    return {
      is_swing: true,
      playback_swing_outcome: 'FOUL',
      playback_swing_hit_type: '',
    };
  }

  return {
    is_swing: true,
    playback_swing_outcome: 'FOUL',
    playback_swing_hit_type: '',
  };
}

function mapTerminalFromAbResult(eventType, abEvent) {
  const type = (eventType || '').toLowerCase();
  const event = (abEvent || '').toLowerCase();

  if (type.includes('walk') || type.includes('intent_walk') || event.includes('hit by pitch')) {
    return { outcome: null, hitType: '' };
  }
  if (type.includes('strikeout') || event.includes('strikeout')) {
    const swinging = event.includes('swing');
    return swinging ? { outcome: 'WHIFF', hitType: '' } : { outcome: null, hitType: '' };
  }
  if (type === 'single' || event === 'single' || event.includes('single')) {
    return { outcome: 'HIT', hitType: 'SINGLE' };
  }
  if (type === 'double' || event === 'double' || event.includes('double')) {
    return { outcome: 'HIT', hitType: 'DOUBLE' };
  }
  if (type === 'triple' || event === 'triple' || event.includes('triple')) {
    return { outcome: 'HIT', hitType: 'TRIPLE' };
  }
  if (type === 'home_run' || event.includes('home run')) {
    return { outcome: 'HIT', hitType: 'HOMERUN' };
  }

  const hitType = mapOutTypeFromAb(eventType, abEvent);
  if (hitType) return { outcome: 'OUT', hitType };

  return { outcome: 'OUT', hitType: 'FLYOUT' };
}

function mapOutTypeFromAb(eventType, abEvent) {
  const raw = `${eventType || ''} ${abEvent || ''}`.toLowerCase().replace(/[_\s]/g, '');
  if (raw.includes('ground') || raw.includes('gdp') || raw.includes('forceout')) return 'GROUNDOUT';
  if (raw.includes('line')) return 'LINEOUT';
  if (raw.includes('pop')) return 'POPOUT';
  if (raw.includes('fly') || raw.includes('sacfly')) return 'FLYOUT';
  return 'FLYOUT';
}

/**
 * Apply MLB pitch record to live game swing / count state (no random simulation).
 */
export function applyMlbPitchPlaybackState(pitch) {
  if (!pitch) return;

  const isSwing = Boolean(pitch.is_swing);
  return {
    isBatterSwinging: isSwing,
    swingOutcome: pitch.playback_swing_outcome ?? pitch.swing_outcome ?? null,
    swingHitType: pitch.playback_swing_hit_type ?? pitch.swing_hit_type ?? '',
    abBalls: pitch.balls ?? 0,
    abStrikes: pitch.strikes ?? 0,
    inningOuts: pitch.outs ?? 0,
  };
}
