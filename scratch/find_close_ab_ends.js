import { WEEKLY_CHALLENGE_DATA } from '../src/data/weekly_challenge.js';

// Calculate t_cross and cross position
const PLATE_MIDPOINT_Z = 0.7083;
function getCrossingTime(p) {
  const a = 0.5 * p.ay;
  const b = p.vy0;
  const c = p.release_pos_y - PLATE_MIDPOINT_Z;
  if (Math.abs(a) < 0.0001) return c / -b;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return c / -b;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

function getBallPositionAtTime(p, t) {
  const x = -(p.release_pos_x + p.vx0 * t + 0.5 * p.ax * t * t);
  const z = p.release_pos_y + p.vy0 * t + 0.5 * p.ay * t * t;
  const y = p.release_pos_z + p.vz0 * t + 0.5 * p.az * t * t;
  return { x, y, z };
}

function getCloseness(p) {
  const t = getCrossingTime(p);
  const pos = getBallPositionAtTime(p, t);
  const hw = 0.7083 + 0.12; // 0.8283
  const vBot = p.sz_bot - 0.12;
  const vTop = p.sz_top + 0.12;
  
  const dx = Math.abs(Math.abs(pos.x) - hw);
  const dy = Math.min(Math.abs(pos.y - vBot), Math.abs(pos.y - vTop));
  return Math.min(dx, dy);
}

// Group weekly challenge pitches into at-bats
const allABs = [];
WEEKLY_CHALLENGE_DATA.forEach((game, gameIdx) => {
  let currentBatter = null;
  let currentPitches = [];
  
  game.pitches.forEach(pitch => {
    if (pitch.batter !== currentBatter && currentPitches.length > 0) {
      allABs.push({
        gameTitle: game.title,
        pitches: currentPitches,
        batter: currentPitches[0].batter,
        pitcher: currentPitches[0].pitcher
      });
      currentPitches = [];
    }
    currentBatter = pitch.batter;
    currentPitches.push(pitch);
  });
  
  if (currentPitches.length > 0) {
    allABs.push({
      gameTitle: game.title,
      pitches: currentPitches,
      batter: currentPitches[0].batter,
      pitcher: currentPitches[0].pitcher
    });
  }
});

// For each AB, check if the last pitch was a taken borderline pitch
const borderlineABs = [];

allABs.forEach(ab => {
  const lastPitch = ab.pitches[ab.pitches.length - 1];
  if (lastPitch && !lastPitch.is_swing) {
    const closeness = getCloseness(lastPitch);
    borderlineABs.push({
      ab,
      closeness,
      lastPitch
    });
  }
});

// Sort by closeness ascending
borderlineABs.sort((a, b) => a.closeness - b.closeness);

console.log("FOUND BORDERLINE ABs Count:", borderlineABs.length);
console.log("TOP 8 CLOSEST AT-BAT ENDS:");
borderlineABs.slice(0, 8).forEach((item, idx) => {
  console.log(`\n[${idx + 1}] Closeness: ${item.closeness.toFixed(4)} ft (approx ${(item.closeness * 12).toFixed(1)} inches)`);
  console.log(`Game: ${item.ab.gameTitle} | P: ${item.ab.pitcher} vs B: ${item.ab.batter}`);
  console.log(`Last Pitch Call (ABS): ${item.lastPitch.abs_call || item.lastPitch.real_ump_call}`);
  console.log(`Pitches: ${item.ab.pitches.length}`);
});
