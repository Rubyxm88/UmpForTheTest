import fs from 'fs';
import path from 'path';

// Helper to parse CLI arguments
const args = process.argv.slice(2);
const inputArgIdx = args.indexOf('--input');
const outputArgIdx = args.indexOf('--output');
const modeArgIdx = args.indexOf('--mode');

if (inputArgIdx === -1 || outputArgIdx === -1) {
  console.error('Usage: node scripts/import-statcast.js --input <savant_data.csv> --output <destination.js> [--mode weekly|daily]');
  process.exit(1);
}

const inputPath = args[inputArgIdx + 1];
const outputPath = args[outputArgIdx + 1];
const mode = modeArgIdx !== -1 ? args[modeArgIdx + 1] : 'weekly';

console.log(`Starting Statcast Import:`);
console.log(`- Input: ${inputPath}`);
console.log(`- Output: ${outputPath}`);
console.log(`- Mode: ${mode}`);

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

// Map short codes to full pitch type names
const PITCH_TYPES = {
  'FF': 'Four-Seam Fastball',
  'SL': 'Slider',
  'CU': 'Curveball',
  'KC': 'Knuckle Curve',
  'CH': 'Changeup',
  'FC': 'Cutter',
  'SI': 'Sinker',
  'FS': 'Splitter',
  'ST': 'Sweeper',
  'SV': 'Slurve',
  'KN': 'Knuckleball',
  'EP': 'Eephus',
  'FA': 'Other'
};

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Standard constant acceleration model to calculate crossing point (Z = 0.7083)
const BALL_RADIUS = 0.12;
const PLATE_HALF_WIDTH = 1.4167 / 2;
const PLATE_MIDPOINT_Z = 0.7083;

function calculateCrossingPoint(pitch) {
  const a = 0.5 * pitch.ay;
  const b = pitch.vy0;
  const c = pitch.release_pos_y - PLATE_MIDPOINT_Z;

  let t = 0;
  if (Math.abs(a) < 0.0001) {
    t = c / -b;
  } else {
    const discriminant = Math.pow(b, 2) - 4 * a * c;
    if (discriminant < 0) {
      t = c / -b;
    } else {
      t = (-b - Math.sqrt(discriminant)) / (2 * a);
    }
  }

  // Calculate Three.js coordinates
  // Three.js X = - (Statcast X)
  const crossX = -(pitch.release_pos_x + pitch.vx0 * t + 0.5 * pitch.ax * Math.pow(t, 2));
  // Three.js Y = Statcast Z (Height)
  const crossY = pitch.release_pos_z + pitch.vz0 * t + 0.5 * pitch.az * Math.pow(t, 2);

  return { x: crossX, y: crossY };
}

function evaluateABSCall(pitch, cross) {
  const isWithinHorizontal = Math.abs(cross.x) <= (PLATE_HALF_WIDTH + BALL_RADIUS);
  const isWithinVertical = cross.y >= (pitch.sz_bot - BALL_RADIUS) && cross.y <= (pitch.sz_top + BALL_RADIUS);
  return (isWithinHorizontal && isWithinVertical) ? 'S' : 'B';
}

const fileContent = fs.readFileSync(inputPath, 'utf-8');
const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '');

if (lines.length < 2) {
  console.error('CSV is empty or missing data rows');
  process.exit(1);
}

const headers = parseCSVLine(lines[0]);
const colMap = {};
headers.forEach((h, idx) => {
  colMap[h] = idx;
});

console.log(`Found CSV Headers: ${headers.length} columns`);

const atBats = {};

for (let i = 1; i < lines.length; i++) {
  const row = parseCSVLine(lines[i]);
  if (row.length < headers.length) continue;

  const getValue = (colName, fallback = null) => {
    const idx = colMap[colName];
    if (idx === undefined || row[idx] === undefined || row[idx] === '') return fallback;
    return row[idx];
  };

  const getFloat = (colName, fallback = 0.0) => {
    const val = getValue(colName);
    return val !== null ? parseFloat(val) : fallback;
  };

  const game_pk = getValue('game_pk');
  const at_bat_number = getValue('at_bat_number');
  
  if (!game_pk || !at_bat_number) continue;

  const key = `${game_pk}_${at_bat_number}`;

  // Extract velocities and accelerations
  const vx0 = getFloat('vx0', null);
  const vy0 = getFloat('vy0', null);
  const vz0 = getFloat('vz0', null);
  const ax = getFloat('ax', null);
  const ay = getFloat('ay', null);
  const az = getFloat('az', null);

  // If missing critical physics parameters, skip this pitch
  if (vx0 === null || vy0 === null || vz0 === null || ax === null || ay === null || az === null) {
    continue;
  }

  // Parse Player Names
  let pitcher = getValue('pitcher_name') || getValue('player_name') || 'Pitcher';
  let batter = getValue('batter_name') || getValue('hitter_name') || 'Batter';
  if (pitcher.includes(',')) {
    const parts = pitcher.split(',');
    pitcher = `${parts[1].trim()} ${parts[0].trim()}`;
  }
  if (batter.includes(',')) {
    const parts = batter.split(',');
    batter = `${parts[1].trim()} ${parts[0].trim()}`;
  }

  // Fallback extract batter from des if generic
  if (batter === 'Batter' && getValue('des')) {
    const des = getValue('des');
    const match = des.match(/(.+) pitches to ([^.,]+)/i);
    if (match) {
      batter = match[2].trim();
    } else {
      const words = des.split(' ');
      if (words.length >= 2) {
        batter = `${words[0]} ${words[1]}`;
      }
    }
  }

  // Determine Swings and Calls
  const description = (getValue('description') || '').toLowerCase();
  const events = (getValue('events') || '').toLowerCase();
  
  let is_swing = false;
  let swing_outcome = null;
  let swing_hit_type = null;

  if (description.includes('swinging_strike') || description.includes('miss') || description.includes('foul_tip')) {
    is_swing = true;
    swing_outcome = 'WHIFF';
  } else if (description.includes('foul')) {
    is_swing = true;
    swing_outcome = 'FOUL';
  } else if (description.includes('hit_into_play')) {
    is_swing = true;
    if (events.includes('single')) {
      swing_outcome = 'HIT';
      swing_hit_type = 'SINGLE';
    } else if (events.includes('double')) {
      swing_outcome = 'HIT';
      swing_hit_type = 'DOUBLE';
    } else if (events.includes('triple')) {
      swing_outcome = 'HIT';
      swing_hit_type = 'TRIPLE';
    } else if (events.includes('home_run')) {
      swing_outcome = 'HIT';
      swing_hit_type = 'HOMERUN';
    } else if (events.includes('out') || events.includes('double_play') || events.includes('triple_play') || events.includes('sac_fly')) {
      swing_outcome = 'OUT';
      if (events.includes('fly')) {
        swing_hit_type = 'FLYOUT';
      } else {
        swing_hit_type = 'GROUNDOUT';
      }
    } else {
      swing_outcome = 'OUT';
      swing_hit_type = 'GROUNDOUT';
    }
  }

  // Determine Real Umpire Call on Taken Pitches
  let real_ump_call = 'B';
  if (description.includes('called_strike')) {
    real_ump_call = 'S';
  }

  const pitchTypeShort = getValue('pitch_type', 'FA');
  const pitch_type = PITCH_TYPES[pitchTypeShort] || 'Other Fastball';

  const pitchData = {
    pitch_number: parseInt(getValue('pitch_number') || '1'),
    inning: parseInt(getValue('inning') || '1'),
    is_top: getValue('inning_topbot') === 'Top',
    pitcher,
    pitcher_hand: getValue('p_throws') === 'R' ? 'RHP' : 'LHP',
    batter,
    batter_hand: getValue('stand') === 'R' ? 'RHB' : 'LHB',
    pitch_type,
    speed_mph: Math.round(getFloat('release_speed', 90.0) * 10) / 10,
    release_pos_x: getFloat('release_pos_x'),
    release_pos_y: getFloat('release_pos_y', 54.5),
    release_pos_z: getFloat('release_pos_z', 6.0),
    vx0,
    vy0,
    vz0,
    ax,
    ay,
    az,
    sz_top: getFloat('sz_top', 3.4),
    sz_bot: getFloat('sz_bot', 1.6),
    real_ump_call,
    is_swing,
    swing_outcome,
    swing_hit_type
  };

  // Compute crossing point for ABS evaluation
  const cross = calculateCrossingPoint(pitchData);
  pitchData.abs_call = evaluateABSCall(pitchData, cross);
  pitchData.is_critical = (pitchData.abs_call !== pitchData.real_ump_call); // Critical calls are where human got it wrong!

  // Generate historical blurb
  if (pitchData.is_swing) {
    if (pitchData.swing_outcome === 'HIT') {
      pitchData.historical_blurb = `${pitcher} throws a ${pitchData.speed_mph} MPH ${pitch_type}. ${batter} swings and hits a ${swing_hit_type.toLowerCase()}!`;
    } else if (pitchData.swing_outcome === 'FOUL') {
      pitchData.historical_blurb = `${pitcher} throws a ${pitchData.speed_mph} MPH ${pitch_type}. ${batter} swings and fouls it off.`;
    } else {
      pitchData.historical_blurb = `${pitcher} throws a ${pitchData.speed_mph} MPH ${pitch_type}. ${batter} swings and misses!`;
    }
  } else {
    const callStr = pitchData.real_ump_call === 'S' ? 'STRIKE' : 'BALL';
    if (pitchData.is_critical) {
      const correctStr = pitchData.abs_call === 'S' ? 'STRIKE' : 'BALL';
      pitchData.historical_blurb = `${pitcher} throws a ${pitchData.speed_mph} MPH ${pitch_type}. The human umpire called it a ${callStr}, but ABS tracking shows it was a ${correctStr}!`;
    } else {
      pitchData.historical_blurb = `${pitcher} throws a ${pitchData.speed_mph} MPH ${pitch_type}. ${batter} takes for a called ${callStr}.`;
    }
  }

  if (!atBats[key]) {
    atBats[key] = [];
  }
  atBats[key].push(pitchData);
}

// Apply Filtering Rules and assemble games
const games = {};
let importedCount = 0;
let skippedSwings = 0;
let skippedAllSwings = 0;

Object.entries(atBats).forEach(([key, pitches]) => {
  // Sort pitches within at-bat by pitch_number
  pitches.sort((a, b) => a.pitch_number - b.pitch_number);

  // 1. Skip if first pitch is a swing
  if (pitches[0].is_swing) {
    skippedSwings++;
    return;
  }

  // 2. Skip if every single pitch is a swing
  if (pitches.every(p => p.is_swing)) {
    skippedAllSwings++;
    return;
  }

  // Get game metadata from first pitch
  const first = pitches[0];
  const gameKey = first.is_top ? `game_${first.pitcher.replace(/\s+/g, '_')}_${first.inning}` : `game_top_${first.pitcher.replace(/\s+/g, '_')}`;
  
  // Format game identity
  const game_id = key.split('_')[0];
  if (!games[game_id]) {
    games[game_id] = {
      id: `game_${game_id}`,
      title: `${first.is_top ? first.pitcher : 'Opponent'} vs. ${first.is_top ? 'Opponent' : first.pitcher}`,
      description: `Inning-by-inning challenge game with real Statcast play-by-play.`,
      film_room_url: `https://www.mlb.com/video/game/${game_id}`,
      ump_scorecard_url: `https://umpscorecards.com/single_game/?game_id=${game_id}`,
      pitches: []
    };
  }

  // Append pitches to game
  pitches.forEach(p => {
    // Generate id
    p.id = importedCount + 10001;
    games[game_id].pitches.push(p);
    importedCount++;
  });
});

console.log(`Processed:`);
console.log(`- Total Pitches: ${importedCount}`);
console.log(`- Skip ABs (first pitch swing): ${skippedSwings}`);
console.log(`- Skip ABs (all pitches swings): ${skippedAllSwings}`);
console.log(`- Games Formed: ${Object.keys(games).length}`);

// Convert games object to array
let gamesList = Object.values(games);

// Limit games list to 5 for weekly challenge
if (mode === 'weekly') {
  gamesList = gamesList.slice(0, 5);
} else if (mode === 'daily') {
  gamesList = gamesList.slice(0, 1);
}

// Generate the final JS output content
let jsContent = `/**
 * Curated Statcast Pitch Dataset — Real MLB Game Play-by-Play
 * Generated on: ${new Date().toLocaleDateString()}
 */

export const WEEKLY_CHALLENGE_DATA = ${JSON.stringify(gamesList, null, 2)};
`;

if (mode === 'daily') {
  jsContent = `/**
 * Daily Challenge Statcast Pitch Dataset
 * Generated on: ${new Date().toLocaleDateString()}
 */

export const DAILY_CHALLENGE_DATA = ${JSON.stringify(gamesList[0] || null, null, 2)};
`;
}

// Ensure output parent directory exists
const parentDir = path.dirname(outputPath);
if (!fs.existsSync(parentDir)) {
  fs.mkdirSync(parentDir, { recursive: true });
}

fs.writeFileSync(outputPath, jsContent, 'utf-8');
console.log(`Data successfully written to ${outputPath} ✅`);
