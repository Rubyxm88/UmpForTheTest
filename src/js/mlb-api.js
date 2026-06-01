/**
 * MLB Stats API Integration Module
 * Fetches real game data from statsapi.mlb.com for Play Any Game mode.
 * All endpoints are public and require no API key.
 */

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';
const MLB_FEED_BASE = 'https://statsapi.mlb.com/api/v1.1';

/**
 * Mapping of app team names → MLB Stats API team IDs
 */
export const MLB_TEAM_IDS = {
  'Dbacks': 109,
  'Braves': 144,
  'Orioles': 110,
  'Red Sox': 111,
  'Cubs': 112,
  'White Sox': 145,
  'Reds': 113,
  'Guardians': 114,
  'Rockies': 115,
  'Tigers': 116,
  'Astros': 117,
  'Royals': 118,
  'Angels': 108,
  'Dodgers': 119,
  'Marlins': 146,
  'Brewers': 158,
  'Twins': 142,
  'Mets': 121,
  'Yankees': 147,
  'Athletics': 133,
  'Phillies': 143,
  'Pirates': 134,
  'Padres': 135,
  'Giants': 137,
  'Mariners': 136,
  'Cardinals': 138,
  'Rays': 139,
  'Rangers': 140,
  'Blue Jays': 141,
  'Nationals': 120
};

/**
 * Fetch all games for a team within a date range.
 * Returns an array of game summary objects.
 * @param {string} teamName - App team name (e.g. "Orioles")
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<Array>} Array of game summaries
 */
export async function fetchTeamSchedule(teamName, startDate, endDate) {
  const teamId = MLB_TEAM_IDS[teamName];
  if (!teamId) {
    console.warn(`MLB API: Unknown team "${teamName}"`);
    return [];
  }

  try {
    const url = `${MLB_API_BASE}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&teamId=${teamId}&hydrate=linescore`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Schedule fetch failed: ${res.status}`);
    const data = await res.json();

    const games = [];
    if (data.dates && Array.isArray(data.dates)) {
      data.dates.forEach(dateEntry => {
        if (dateEntry.games && Array.isArray(dateEntry.games)) {
          dateEntry.games.forEach(game => {
            if (game.status && game.status.abstractGameState === 'Final' && game.gameType === 'R') {
              games.push({
                gamePk: game.gamePk,
                date: dateEntry.date,
                awayTeam: game.teams.away.team.name,
                awayScore: game.teams.away.score,
                homeTeam: game.teams.home.team.name,
                homeScore: game.teams.home.score,
                venue: game.venue ? game.venue.name : 'Unknown Venue',
                status: game.status.detailedState,
                innings: game.linescore ? game.linescore.currentInning : 9
              });
            }
          });
        }
      });
    }

    return games;
  } catch (err) {
    console.warn('MLB API: Failed to fetch team schedule:', err);
    return [];
  }
}

/**
 * Fetch a single game's schedule info for a specific date.
 * @param {string} teamName - App team name
 * @param {string} dateString - YYYY-MM-DD
 * @returns {Promise<Object|null>} Game summary or null
 */
export async function fetchGameForDate(teamName, dateString) {
  const games = await fetchTeamSchedule(teamName, dateString, dateString);
  return games.length > 0 ? games[0] : null;
}

/** Normalize MLB pitch call codes (e.g. *B → B). */
export function normalizeMlbCallCode(raw) {
  const code = String(raw || '').trim();
  if (code === '*B' || code === 'VB') return 'B';
  if (code === 'W') return 'S'; // Swinging Strike (Blocked) — still a swing
  return code;
}

/**
 * Map MLB API call code to our app format (ball/strike for ump zone game).
 */
function mapCallCode(code) {
  const c = normalizeMlbCallCode(code);
  switch (c) {
    case 'C': return 'S';
    case 'S': return 'S';
    case 'F': return 'S';
    case 'L': return 'S'; // Foul bunt
    case 'X': return 'S'; // In play, out(s)
    case 'D': return 'S'; // In play, no out
    case 'E': return 'S'; // In play, run(s)
    case 'B': return 'B';
    case 'H': return 'B';
    default: return 'B';
  }
}

/** Batter swung on this pitch (includes all in-play contact codes). */
export function isSwingPitch(callCode) {
  const c = normalizeMlbCallCode(callCode);
  return ['S', 'F', 'L', 'X', 'D', 'E'].includes(c);
}

/**
 * Calculate the absolute correct call based on pitch location vs strike zone
 */
function calculateAbsCall(pX, pZ, szTop, szBot) {
  const halfPlateWidth = 0.8283; // feet (17 inches / 2 / 12)
  const tolerance = 0.12; // small tolerance for borderline calls
  const isStrike = Math.abs(pX) <= halfPlateWidth &&
                   pZ >= (szBot - tolerance) &&
                   pZ <= (szTop + tolerance);
  return isStrike ? 'S' : 'B';
}

import { mapPitchPlaybackFields, isInPlayMlbCallCode } from './mlb-playback.js';

/** Bump when feed parsing changes — invalidates IndexedDB game cache entries. */
/** Bump when feed parsing changes (incl. Statcast call codes E/D/*B/W). */
export const MLB_GAME_FEED_PARSE_VERSION = 6;

const MLB_PITCH_CALL_CODES = new Set(['C', 'S', 'F', 'L', 'X', 'D', 'E', 'B', 'H', '*B', 'W']);

/**
 * Map MLB event type to our swing outcome format
 */
/** Short label for at-bat result (K, 1B, BB, etc.). */
export function formatAbOutcomeShort(abEvent, abEventType) {
  const event = (abEvent || '').toLowerCase();
  const type = (abEventType || '').toLowerCase();
  if (event.includes('strikeout') || type.includes('strikeout')) return 'K';
  if (event.includes('walk') || type.includes('walk')) return 'BB';
  if (event.includes('hit by pitch') || type.includes('hit_by_pitch')) return 'HBP';
  if (event === 'single' || type === 'single') return '1B';
  if (event === 'double' || type === 'double') return '2B';
  if (event === 'triple' || type === 'triple') return '3B';
  if (event.includes('home run') || type === 'home_run') return 'HR';
  if (event.includes('ground') || type.includes('ground')) return 'GO';
  if (event.includes('fly') || type.includes('fly')) return 'FO';
  if (event.includes('line') || type.includes('line')) return 'LO';
  if (event.includes('pop') || type.includes('pop')) return 'PO';
  if (event.includes('sacrifice')) return 'SAC';
  if (event.includes('error')) return 'E';
  if (abEvent) {
    const words = abEvent.trim().split(/\s+/);
    return words.length > 1 ? words[0].slice(0, 4) : abEvent.slice(0, 5);
  }
  return '';
}

function isPlateAppearancePlay(play) {
  if (!play?.matchup?.batter?.fullName) return false;
  const pitchEvents = (play.playEvents || []).filter((e) => e.isPitch === true);
  if (!pitchEvents.length) return false;
  if (play.about?.atBatIndex != null) return true;
  return Boolean(play.result?.eventType || play.result?.event);
}

function mapHitTypeFromAb(eventType, abEvent) {
  const raw = `${eventType || ''} ${abEvent || ''}`.toLowerCase().replace(/[_\s]/g, '');
  if (raw.includes('single')) return 'SINGLE';
  if (raw.includes('double') && !raw.includes('play')) return 'DOUBLE';
  if (raw.includes('triple') && !raw.includes('play')) return 'TRIPLE';
  if (raw.includes('homerun') || raw.includes('homer')) return 'HOMERUN';
  if (raw.includes('ground') || raw.includes('gdp') || raw.includes('forceout') || raw.includes('fielderschoice')) {
    return 'GROUNDOUT';
  }
  if (raw.includes('lineout') || raw.includes('linesout')) return 'LINEOUT';
  if (raw.includes('flyout') || raw.includes('fliesout') || raw.includes('sacfly')) return 'FLYOUT';
  if (raw.includes('popout') || raw.includes('popup')) return 'POPOUT';
  if (raw.includes('fieldout')) return 'FLYOUT';
  return null;
}

/** Terminal pitch swing result — only when batter actually swung on the final pitch. */
function mapTerminalSwingOutcome(eventType, abEvent, lastCallCode) {
  const type = (eventType || '').toLowerCase();
  const event = (abEvent || '').toLowerCase();
  const lastSwing = isSwingPitch(lastCallCode);

  if (type.includes('walk') || type.includes('intent_walk') || type.includes('hit_by_pitch') || event.includes('hit by pitch')) {
    return { outcome: null, hitType: null };
  }

  if (type.includes('strikeout') || event.includes('strikeout')) {
    const swinging = event.includes('swing') || lastSwing;
    return swinging ? { outcome: 'WHIFF', hitType: null } : { outcome: null, hitType: null };
  }

  if (type === 'single' || event === 'single') return { outcome: 'HIT', hitType: 'SINGLE' };
  if (type === 'double' || event === 'double') return { outcome: 'HIT', hitType: 'DOUBLE' };
  if (type === 'triple' || event === 'triple') return { outcome: 'HIT', hitType: 'TRIPLE' };
  if (type === 'home_run' || event.includes('home run')) return { outcome: 'HIT', hitType: 'HOMERUN' };

  const inPlayOut =
    type === 'field_out' || type === 'force_out' || type === 'double_play'
    || type === 'grounded_into_double_play' || type === 'fielders_choice'
    || type === 'fielders_choice_out' || type === 'sac_fly' || type === 'sac_bunt'
    || event.includes('out');

  if (inPlayOut && lastSwing) {
    return { outcome: 'OUT', hitType: mapHitTypeFromAb(eventType, abEvent) || 'FLYOUT' };
  }

  if (lastSwing) {
    return { outcome: 'OUT', hitType: mapHitTypeFromAb(eventType, abEvent) || 'FLYOUT' };
  }

  return { outcome: null, hitType: null };
}

function buildPitchBlurb({
  pitcher,
  batter,
  pitchType,
  callCode,
  isLast,
  isSwing,
  swingOutcome,
  swingHitType,
  abEvent,
}) {
  if (isLast && swingOutcome === 'HIT') {
    return `${batter} ${abEvent ? abEvent.toLowerCase() : 'hits'} off ${pitcher}'s ${pitchType}!`;
  }
  if (isLast && swingOutcome === 'WHIFF') {
    return `${batter} strikes out swinging on ${pitcher}'s ${pitchType}!`;
  }
  if (isLast && swingOutcome === 'OUT') {
    return `${batter} ${abEvent ? abEvent.toLowerCase() : 'makes an out'} on a ${pitchType}.`;
  }
  if (isLast && abEvent) {
    return `${batter} ${abEvent.toLowerCase()} (${pitchType}).`;
  }
  if (isSwing && callCode === 'F') {
    return `${batter} fouls off a ${pitchType} from ${pitcher}.`;
  }
  if (isSwing && callCode === 'S') {
    return `${batter} swings and misses at a ${pitchType} from ${pitcher}.`;
  }
  if (isSwing) {
    return `${batter} swings at ${pitcher}'s ${pitchType}.`;
  }
  const callDesc = mapCallCode(callCode) === 'S' ? 'called STRIKE' : 'called BALL';
  return `${pitcher} throws a ${pitchType}. ${batter} takes for a ${callDesc}.`;
}

function parsePlateAppearancePitches(play, pitchIdStart) {
  const pitcher = play.matchup.pitcher?.fullName || 'Unknown Pitcher';
  const batter = play.matchup.batter?.fullName || 'Unknown Batter';
  const pitchHand = resolveMlbPitchHand(play.matchup.pitchHand?.code);
  const batSide = resolveMlbBatSide(play.matchup.batSide?.code);
  const inning = play.about?.inning || 1;
  const isTop = play.about?.isTopInning ?? true;
  const atBatIndex = play.about?.atBatIndex ?? null;

  const abResult = play.result?.eventType || '';
  const abEvent = play.result?.event || '';
  const abDescription = play.result?.description || '';
  const abOutcomeShort = formatAbOutcomeShort(abEvent, abResult);
  const scoreAway = play.result?.awayScore ?? 0;
  const scoreHome = play.result?.homeScore ?? 0;

  const pitchEvents = (play.playEvents || []).filter((e) => e.isPitch === true);
  const lastIdx = pitchEvents.length - 1;
  const pitches = [];
  let pitchIdCounter = pitchIdStart;

  pitchEvents.forEach((pitchEvent, pIdx) => {
    const pd = pitchEvent.pitchData;
    const details = pitchEvent.details;
    if (!pd || !details) return;

    const rawCallCode = details.call?.code || '';
    if (!MLB_PITCH_CALL_CODES.has(rawCallCode)) return;
    const callCode = normalizeMlbCallCode(rawCallCode);

    const coords = pd.coordinates || {};
    const isLast = pIdx === lastIdx;
    const playback = mapPitchPlaybackFields(callCode, isLast, abResult, abEvent, details);
    const isSwing = playback.is_swing;

    let swingOutcome = playback.playback_swing_outcome;
    let swingHitType = playback.playback_swing_hit_type;
    if (isLast) {
      const mapped = mapTerminalSwingOutcome(abResult, abEvent, callCode);
      if (mapped.outcome) {
        swingOutcome = mapped.outcome;
        swingHitType = mapped.hitType || swingHitType;
      } else if (isInPlayMlbCallCode(callCode) || callCode === 'F' || callCode === 'S') {
        swingOutcome = playback.playback_swing_outcome;
        swingHitType = playback.playback_swing_hit_type || swingHitType;
      }
    }

    const pX = coords.pX ?? 0;
    const pZ = coords.pZ ?? 2.5;
    const szTop = pd.strikeZoneTop ?? 3.4;
    const szBot = pd.strikeZoneBottom ?? 1.6;
    const pitchType = mapPitchType(details.type?.description, details.type?.code);
    const count = pitchEvent.count || {};

    pitches.push({
      id: pitchIdCounter++,
      inning,
      is_top: isTop,
      at_bat_index: atBatIndex,
      pitcher,
      pitcher_hand: pitchHand,
      batter,
      batter_hand: batSide,
      pitch_type: pitchType,
      speed_mph: Math.round(pd.startSpeed || 90),
      release_pos_x: coords.x0 ?? 0,
      release_pos_y: coords.y0 ?? 50,
      release_pos_z: coords.z0 ?? 6,
      vx0: coords.vX0 ?? 0,
      vy0: coords.vY0 ?? -130,
      vz0: coords.vZ0 ?? -6,
      ax: coords.aX ?? 0,
      ay: coords.aY ?? 25,
      az: coords.aZ ?? -15,
      sz_top: szTop,
      sz_bot: szBot,
      real_ump_call: mapCallCode(callCode),
      abs_call: calculateAbsCall(pX, pZ, szTop, szBot),
      is_critical: false,
      historical_blurb: buildPitchBlurb({
        pitcher,
        batter,
        pitchType,
        callCode,
        isLast,
        isSwing,
        swingOutcome,
        swingHitType,
        abEvent,
      }),
      mlb_call_code: callCode,
      mlb_call_code_raw: rawCallCode,
      is_swing: isSwing,
      playback_swing_outcome: playback.playback_swing_outcome,
      playback_swing_hit_type: playback.playback_swing_hit_type,
      swing_outcome: swingOutcome,
      swing_hit_type: swingHitType,
      ab_event: isLast ? abEvent || null : null,
      ab_event_type: isLast ? abResult || null : null,
      ab_description: isLast ? abDescription || null : null,
      ab_outcome_short: isLast ? abOutcomeShort : null,
      score_away: scoreAway,
      score_home: scoreHome,
      outs: count.outs ?? 0,
      balls: count.balls ?? 0,
      strikes: count.strikes ?? 0,
      runners: [0, 0, 0],
    });
  });

  return { pitches, nextId: pitchIdCounter };
}

/**
 * Map MLB pitch type code to human-readable description
 */
function mapPitchType(typeDescription, typeCode) {
  if (typeDescription) return typeDescription;
  const map = {
    'FF': 'Four-Seam Fastball', 'SI': 'Sinker', 'FC': 'Cutter',
    'SL': 'Slider', 'CU': 'Curveball', 'CH': 'Changeup',
    'FS': 'Splitter', 'KC': 'Knuckle Curve', 'KN': 'Knuckleball',
    'ST': 'Sweeper', 'SV': 'Slurve', 'CS': 'Slow Curve',
    'EP': 'Eephus', 'SC': 'Screwball'
  };
  return map[typeCode] || 'Fastball';
}

/**
 * Fetch full play-by-play and build one array of pitches per MLB plate appearance.
 * Each at-bat is exactly one `allPlays` entry (real pitch sequence, calls, terminal result).
 * @param {number} gamePk - MLB game ID
 * @returns {Promise<Array<Array>>} At-bat arrays for preview + umpire replay
 */
export async function fetchGamePitches(gamePk) {
  try {
    const url = `${MLB_FEED_BASE}/game/${gamePk}/feed/live`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Game feed fetch failed: ${res.status}`);
    const data = await res.json();

    const allPlays = data.liveData?.plays?.allPlays;
    if (!allPlays || !Array.isArray(allPlays)) {
      throw new Error('No play data found in game feed');
    }

    const atBats = [];
    let pitchIdCounter = 30000;

    for (const play of allPlays) {
      if (!isPlateAppearancePlay(play)) continue;
      const parsed = parsePlateAppearancePitches(play, pitchIdCounter);
      pitchIdCounter = parsed.nextId;
      if (parsed.pitches.length > 0) {
        atBats.push(parsed.pitches);
      }
    }

    return atBats;
  } catch (err) {
    console.warn('MLB API: Failed to fetch game pitches:', err);
    return null;
  }
}

/** Human-readable game time from MLB `gameDate` ISO string. */
export function formatGameDateTime(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Human-readable at-bat result from MLB play data (last pitch of AB). */
export function formatMlbAbOutcomeText(lastPitch) {
  if (!lastPitch) return 'AT-BAT COMPLETE';
  const batter = lastPitch.batter || 'Batter';
  const event = (lastPitch.ab_event || '').trim();
  const type = (lastPitch.ab_event_type || '').toLowerCase();
  const eventLower = event.toLowerCase();

  if (lastPitch.ab_outcome_short === 'HR') {
    return `${batter.toUpperCase()} HOME RUN!`;
  }
  if (lastPitch.ab_outcome_short === '1B') {
    return `${batter.toUpperCase()} SINGLES!`;
  }
  if (lastPitch.ab_outcome_short === '2B') {
    return `${batter.toUpperCase()} DOUBLES!`;
  }
  if (lastPitch.ab_outcome_short === '3B') {
    return `${batter.toUpperCase()} TRIPLES!`;
  }
  if (event) {
    return `${batter.toUpperCase()} — ${event.toUpperCase()}`;
  }

  if (type.includes('strikeout') || eventLower.includes('strikeout')) {
    return `${batter.toUpperCase()} STRIKEOUT!`;
  }
  if (type.includes('walk') || eventLower.includes('walk')) {
    return `${batter.toUpperCase()} WALKS!`;
  }
  if (type === 'home_run' || eventLower.includes('home run')) {
    return `${batter.toUpperCase()} HOME RUN!`;
  }
  if (type === 'single' || eventLower === 'single') return `${batter.toUpperCase()} SINGLES!`;
  if (type === 'double' || eventLower === 'double') return `${batter.toUpperCase()} DOUBLES!`;
  if (type === 'triple' || eventLower === 'triple') return `${batter.toUpperCase()} TRIPLES!`;
  if (lastPitch.swing_outcome === 'HIT' && lastPitch.swing_hit_type) {
    return `${batter.toUpperCase()} HITS A ${lastPitch.swing_hit_type}!`;
  }
  if (lastPitch.swing_outcome === 'OUT') {
    return `${batter.toUpperCase()} OUT (${lastPitch.swing_hit_type || 'OUT'})`;
  }
  if (event) return `${batter.toUpperCase()} — ${event.toUpperCase()}`;
  if (lastPitch.ab_description) {
    const short = lastPitch.ab_description.length > 48
      ? `${lastPitch.ab_description.slice(0, 45)}…`
      : lastPitch.ab_description;
    return short.toUpperCase();
  }
  return 'AT-BAT COMPLETE';
}

/** Status line for preview header (live inning or final + time). */
export function formatGameStatusLine(game, formatDisplayDateFn) {
  if (game.isLive) {
    const half = game.inningHalf
      ? game.inningHalf.toLowerCase().startsWith('top')
        ? 'Top'
        : 'Bot'
      : '';
    const inn = game.currentInning ? `${half} ${game.currentInning}`.trim() : '';
    return inn ? `${inn} · Live` : 'Live';
  }
  const when = formatGameDateTime(game.gameDateTime) || (formatDisplayDateFn ? formatDisplayDateFn(game.date) : game.date);
  return when ? `Final · ${when}` : 'Final';
}

/** Local calendar date as YYYY-MM-DD (avoids UTC midnight shifting "today"). */
export function formatLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Before this local hour, yesterday is the sensible default browse date. */
export const MLB_BROWSE_DAY_ROLLOVER_HOUR = 10;

/** Default MLB browse date — yesterday before rollover, calendar today after. */
export function getDefaultBrowseDate(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < MLB_BROWSE_DAY_ROLLOVER_HOUR) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/** Earliest season year for MLB game browse (Statcast-era schedule feed). */
export const MLB_BROWSE_MIN_YEAR = 2015;

export function getMlbBrowseMaxDateIso() {
  return formatLocalDateString();
}

export function getMlbBrowseMinDateIso() {
  return `${MLB_BROWSE_MIN_YEAR}-01-01`;
}

/** Descending list of selectable years (newest first). */
export function getMlbBrowseYears() {
  const maxYear = new Date().getFullYear();
  const years = [];
  for (let y = maxYear; y >= MLB_BROWSE_MIN_YEAR; y -= 1) {
    years.push(y);
  }
  return years;
}

function parseScheduleGame(game, dateEntry) {
  if (!game?.status || game.gameType !== 'R') return null;
  const state = game.status.abstractGameState;
  const isFinal = state === 'Final';
  const isLive = state === 'Live' || state === 'In Progress';
  if (!isFinal && !isLive) return null;

  const ls = game.linescore || {};
  const inningHalf = ls.inningState || null;

  return {
    gamePk: game.gamePk,
    date: dateEntry.date,
    awayTeam: game.teams.away.team.name,
    awayScore: game.teams.away.score ?? 0,
    homeTeam: game.teams.home.team.name,
    homeScore: game.teams.home.score ?? 0,
    venue: game.venue ? game.venue.name : 'Unknown Venue',
    status: game.status.detailedState,
    abstractState: state,
    isFinal,
    isLive,
    gameDateTime: game.gameDate || null,
    currentInning: ls.currentInning ?? null,
    inningHalf,
    innings: ls.currentInning ?? null,
  };
}

/**
 * Fetch all regular-season games for a date.
 * Finals always included; in-progress/preview included for that calendar day.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Promise<Array>} Array of game summaries
 */
export async function fetchAllGamesForDate(dateStr) {
  try {
    const url = `${MLB_API_BASE}/schedule?sportId=1&startDate=${dateStr}&endDate=${dateStr}&hydrate=linescore`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Schedule fetch failed: ${res.status}`);
    const data = await res.json();

    const games = [];
    if (data.dates && Array.isArray(data.dates)) {
      data.dates.forEach((dateEntry) => {
        if (!dateEntry.games?.length) return;
        dateEntry.games.forEach((game) => {
          const row = parseScheduleGame(game, dateEntry);
          if (row) games.push(row);
        });
      });
    }
    return games;
  } catch (err) {
    console.warn('MLB API: Failed to fetch all games for date:', err);
    return [];
  }
}

/**
 * Recent games: rolling window of calendar days (default 3).
 * Keeps yesterday visible while today's games are in progress.
 */
export async function fetchRecentGames(daysBack = 3) {
  const today = new Date();
  const dates = [];
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(formatLocalDateString(d));
  }

  const batches = await Promise.all(dates.map((d) => fetchAllGamesForDate(d)));
  const byPk = new Map();
  batches.flat().forEach((g) => {
    if (!byPk.has(g.gamePk)) byPk.set(g.gamePk, g);
  });

  return [...byPk.values()].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.gamePk - a.gamePk;
  });
}

/**
 * Convert at-bat arrays from fetchGamePitches into playlist entries for launchGame.
 */
export function atBatsToPlaylist(rawAtBats, gameSummary) {
  if (!rawAtBats?.length) return [];
  const filmRoomUrl = `https://www.mlb.com/video/game/${gameSummary.gamePk}`;
  const umpScorecardUrl = `https://umpscorecards.com/single_game/?game_id=${gameSummary.gamePk}`;

  return rawAtBats.map((pitches, idx) => {
    const first = pitches[0] || {};
    return {
      gameIndex: 0,
      gamePk: gameSummary.gamePk,
      gameTitle: `${gameSummary.awayTeam} @ ${gameSummary.homeTeam}`,
      filmRoomUrl,
      umpScorecardUrl,
      pitcher: first.pitcher,
      batter: first.batter,
      pitcher_hand: first.pitcher_hand || 'RHP',
      batter_hand: first.batter_hand || 'RHB',
      inning: first.inning,
      is_top: first.is_top,
      pitches,
      completed: false,
      userCorrectCount: 0,
      userTotalCount: 0,
      abIndex: idx,
    };
  });
}

/** Map MLB pitchHand code → LHP/RHP. */
export function resolveMlbPitchHand(code) {
  const c = String(code || 'R').toUpperCase();
  return c.startsWith('L') ? 'LHP' : 'RHP';
}

/** Map MLB batSide code → LHB/RHB (uses actual PA side; switch hitters resolve to L or R). */
export function resolveMlbBatSide(code) {
  const c = String(code || 'R').toUpperCase();
  return c.startsWith('L') ? 'LHB' : 'RHB';
}

const mlbProfileCache = new Map();

/**
 * Fetch season stats + bio for a player card popout (cached per name+role).
 * @param {string} playerName
 * @param {'pitcher'|'batter'} role
 * @returns {Promise<Object|null>}
 */
export async function fetchMlbPlayerProfile(playerName, role) {
  const key = `${role}:${playerName}`;
  if (mlbProfileCache.has(key)) return mlbProfileCache.get(key);

  try {
    const searchRes = await fetch(
      `${MLB_API_BASE}/people/search?names=${encodeURIComponent(playerName)}`
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const person = searchData?.people?.[0];
    if (!person?.id) return null;

    const isPitcher = role === 'pitcher';
    const group = isPitcher ? 'pitching' : 'hitting';
    const statsRes = await fetch(
      `${MLB_API_BASE}/people/${person.id}/stats?stats=season&group=${group}&season=${new Date().getFullYear()}`
    );
    const statsData = statsRes.ok ? await statsRes.json() : null;
    const stat = statsData?.stats?.[0]?.splits?.[0]?.stat || {};

    const height = person.height || `6' 0"`;
    const weight = person.weight ? `${person.weight} lbs` : '200 lbs';
    const hand = isPitcher
      ? resolveMlbPitchHand(person.pitchHand?.code)
      : resolveMlbBatSide(person.batSide?.code);

    let profile;
    if (isPitcher) {
      profile = {
        role: 'PITCHER',
        hand,
        handLabel: 'Throws',
        team: person.currentTeam?.name || person.team?.name || '',
        height,
        weight,
        stats: {
          ERA: stat.era != null ? Number(stat.era).toFixed(2) : '--',
          WHIP: stat.whip != null ? Number(stat.whip).toFixed(2) : '--',
          SO: stat.strikeOuts != null ? String(stat.strikeOuts) : '--',
          IP: stat.inningsPitched || '--',
          'W-L': `${stat.wins ?? 0}-${stat.losses ?? 0}`,
          WAR: stat.war != null ? Number(stat.war).toFixed(1) : '--',
        },
      };
    } else {
      const avg = stat.avg != null ? Number(stat.avg).toFixed(3).replace(/^0/, '') : '--';
      const obp = stat.obp != null ? Number(stat.obp).toFixed(3).replace(/^0/, '') : '--';
      const slg = stat.slg != null ? Number(stat.slg).toFixed(3).replace(/^0/, '') : '--';
      const ops = stat.ops != null ? Number(stat.ops).toFixed(3) : '--';
      profile = {
        role: 'BATTER',
        hand,
        handLabel: 'Bats',
        team: person.currentTeam?.name || person.team?.name || '',
        height,
        weight,
        stats: {
          AVG: avg,
          HR: stat.homeRuns != null ? String(stat.homeRuns) : '--',
          RBI: stat.rbi != null ? String(stat.rbi) : '--',
          OPS: ops,
          OBP: obp,
          SLG: slg,
        },
      };
    }

    mlbProfileCache.set(key, profile);
    return profile;
  } catch (err) {
    console.warn('MLB API: player profile fetch failed:', playerName, err);
    return null;
  }
}

/** Pick ~15 representative at-bats for condensed play. */
export function pickCondensedAtBats(rawAtBats, maxAbs = 15) {
  if (!rawAtBats?.length) return [];
  if (rawAtBats.length <= maxAbs) return rawAtBats;
  const step = rawAtBats.length / maxAbs;
  const picked = [];
  for (let i = 0; i < maxAbs; i++) {
    picked.push(rawAtBats[Math.min(rawAtBats.length - 1, Math.floor(i * step))]);
  }
  return picked;
}
