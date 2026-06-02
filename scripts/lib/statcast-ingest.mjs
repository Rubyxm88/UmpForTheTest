/**
 * Statcast CSV → scored Streak AB rows.
 *
 * Pure, dependency-light pipeline shared by the CLI importer and the admin
 * ingest API. Parses a baseball-savant "type=details" CSV, groups pitches into
 * at-bats, scores each AB for streak eligibility/difficulty, and maps results
 * to `streak_at_bats` row shape.
 */

import { scoreStreakAtBat, calculateCrossingPoint } from './streak-ab-scorer.js';

const PITCH_TYPES = {
  FF: 'Four-Seam Fastball', SL: 'Slider', CU: 'Curveball', KC: 'Knuckle Curve',
  CH: 'Changeup', FC: 'Cutter', SI: 'Sinker', FS: 'Splitter', ST: 'Sweeper',
  SV: 'Slurve', KN: 'Knuckleball', EP: 'Eephus', FA: 'Other',
};

const BALL_RADIUS = 0.12;
const PLATE_HALF_WIDTH = 1.4167 / 2;

/** Parse a single CSV line honoring quoted fields. */
export function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** ABS (automated) call from physics crossing point. */
function evaluateAbsCall(pitch, cross) {
  const horizontal = Math.abs(cross.x) <= (PLATE_HALF_WIDTH + BALL_RADIUS);
  const vertical = cross.y >= (pitch.sz_bot - BALL_RADIUS) && cross.y <= (pitch.sz_top + BALL_RADIUS);
  return horizontal && vertical ? 'S' : 'B';
}

function flipName(name) {
  if (name && name.includes(',')) {
    const [last, first] = name.split(',');
    return `${first.trim()} ${last.trim()}`;
  }
  return name;
}

/**
 * Parse Statcast CSV text into a map of at-bats: { "<gamePk>_<abNum>": {meta, pitches[]} }
 */
export function parseStatcastCsv(csvText) {
  const lines = String(csvText || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return {};

  const headers = parseCSVLine(lines[0]);
  const colMap = {};
  headers.forEach((h, idx) => { colMap[h] = idx; });

  const atBats = {};

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length < headers.length) continue;

    const get = (name, fallback = null) => {
      const idx = colMap[name];
      if (idx === undefined || row[idx] === undefined || row[idx] === '') return fallback;
      return row[idx];
    };
    const getF = (name, fallback = 0) => {
      const v = get(name);
      return v !== null ? parseFloat(v) : fallback;
    };

    const gamePk = get('game_pk');
    const atBatNumber = get('at_bat_number');
    if (!gamePk || !atBatNumber) continue;

    const vx0 = getF('vx0', null), vy0 = getF('vy0', null), vz0 = getF('vz0', null);
    const ax = getF('ax', null), ay = getF('ay', null), az = getF('az', null);
    if ([vx0, vy0, vz0, ax, ay, az].some((v) => v === null || Number.isNaN(v))) continue;

    let pitcher = flipName(get('player_name') || get('pitcher_name')) || 'Pitcher';
    let batter = flipName(get('batter_name') || get('hitter_name')) || 'Batter';

    // Savant's standard export has no batter NAME column (only a numeric id),
    // but the AB-level `des` text names the batter (e.g. "Aaron Judge homers.").
    if (batter === 'Batter') {
      const des = get('des') || '';
      const toMatch = des.match(/\bto\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,2})/);
      if (toMatch) {
        batter = toMatch[1].trim();
      } else {
        const m = des.match(/^([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){1,2})\b/);
        if (m) batter = m[1].trim();
      }
    }

    const description = (get('description') || '').toLowerCase();
    const events = (get('events') || '').toLowerCase();

    let is_swing = false, swing_outcome = null, swing_hit_type = null;
    if (description.includes('swinging_strike') || description.includes('foul_tip')) {
      is_swing = true; swing_outcome = 'WHIFF';
    } else if (description.includes('foul')) {
      is_swing = true; swing_outcome = 'FOUL';
    } else if (description.includes('hit_into_play')) {
      is_swing = true;
      if (events.includes('home_run')) { swing_outcome = 'HIT'; swing_hit_type = 'HOMERUN'; }
      else if (events.includes('triple')) { swing_outcome = 'HIT'; swing_hit_type = 'TRIPLE'; }
      else if (events.includes('double')) { swing_outcome = 'HIT'; swing_hit_type = 'DOUBLE'; }
      else if (events.includes('single')) { swing_outcome = 'HIT'; swing_hit_type = 'SINGLE'; }
      else { swing_outcome = 'OUT'; swing_hit_type = events.includes('fly') ? 'FLYOUT' : 'GROUNDOUT'; }
    }

    const real_ump_call = description.includes('called_strike') ? 'S' : 'B';
    const pitchTypeShort = get('pitch_type', 'FA');

    const pitch = {
      pitch_number: parseInt(get('pitch_number') || '1', 10),
      inning: parseInt(get('inning') || '1', 10),
      is_top: get('inning_topbot') === 'Top',
      pitcher,
      pitcher_hand: get('p_throws') === 'L' ? 'LHP' : 'RHP',
      batter,
      batter_hand: get('stand') === 'L' ? 'LHB' : 'RHB',
      pitch_type: PITCH_TYPES[pitchTypeShort] || 'Other',
      speed_mph: Math.round(getF('release_speed', 90) * 10) / 10,
      release_pos_x: getF('release_pos_x'),
      release_pos_y: getF('release_pos_y', 54.5),
      release_pos_z: getF('release_pos_z', 6.0),
      vx0, vy0, vz0, ax, ay, az,
      sz_top: getF('sz_top', 3.4),
      sz_bot: getF('sz_bot', 1.6),
      real_ump_call,
      is_swing,
      swing_outcome,
      swing_hit_type,
      game_date: get('game_date'),
      home_team: get('home_team'),
      away_team: get('away_team'),
    };

    const cross = calculateCrossingPoint(pitch);
    pitch.abs_call = evaluateAbsCall(pitch, cross);
    pitch.is_critical = pitch.abs_call !== pitch.real_ump_call;

    const key = `${gamePk}_${atBatNumber}`;
    if (!atBats[key]) {
      atBats[key] = {
        gamePk: Number(gamePk),
        atBatNumber: Number(atBatNumber),
        pitcher,
        batter,
        gameDate: pitch.game_date,
        homeTeam: pitch.home_team,
        awayTeam: pitch.away_team,
        pitches: [],
      };
    }
    atBats[key].pitches.push(pitch);
  }

  // Sort each AB's pitches by pitch_number.
  for (const ab of Object.values(atBats)) {
    ab.pitches.sort((a, b) => a.pitch_number - b.pitch_number);
  }

  return atBats;
}

/**
 * Convert parsed at-bats to scored `streak_at_bats` rows.
 * @param {object} atBats - output of parseStatcastCsv
 * @param {object} [opts] - { includeIneligible: boolean }
 * @returns {{ rows: object[], summary: object }}
 */
export function scoreAtBatsToRows(atBats, opts = {}) {
  const includeIneligible = opts.includeIneligible === true;
  const rows = [];
  const rejectReasons = {};
  const tierCounts = [0, 0, 0, 0, 0];
  let eligible = 0;

  for (const [key, ab] of Object.entries(atBats)) {
    const score = scoreStreakAtBat(ab);
    if (!score.eligible) {
      rejectReasons[score.rejectReason] = (rejectReasons[score.rejectReason] || 0) + 1;
      if (!includeIneligible) continue;
    } else {
      eligible++;
      if (score.tier >= 1 && score.tier <= 5) tierCounts[score.tier - 1]++;
    }

    const homeAway = ab.homeTeam && ab.awayTeam ? `${ab.awayTeam} @ ${ab.homeTeam}` : null;

    rows.push({
      id: key,
      game_pk: ab.gamePk,
      at_bat_number: ab.atBatNumber,
      difficulty: score.difficulty,
      tier: score.tier,
      eligible: score.eligible,
      reject_reason: score.rejectReason,
      metrics: score.metrics,
      pitcher: ab.pitcher,
      batter: ab.batter,
      game_title: homeAway,
      film_room_url: ab.gamePk ? `https://www.mlb.com/video/?q=gamepk=${ab.gamePk}` : null,
      ump_scorecard_url: null,
      pitches: ab.pitches,
      last_used_date: null,
    });
  }

  return {
    rows,
    summary: {
      totalAbs: Object.keys(atBats).length,
      eligible,
      ineligible: Object.keys(atBats).length - eligible,
      rejectReasons,
      tierCounts,
    },
  };
}

/** End-to-end: CSV text → scored eligible rows + summary. */
export function buildStreakRowsFromCsv(csvText, opts = {}) {
  const atBats = parseStatcastCsv(csvText);
  return scoreAtBatsToRows(atBats, opts);
}
