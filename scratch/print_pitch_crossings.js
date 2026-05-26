import { WEEKLY_CHALLENGE_DATA } from '../src/data/weekly_challenge.js';

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

const list = [];
WEEKLY_CHALLENGE_DATA.forEach(game => {
  game.pitches.forEach(p => {
    const t = getCrossingTime(p);
    const pos = getBallPositionAtTime(p, t);
    
    // Distance to horizontal boundaries (-0.8283 and 0.8283)
    const dx = Math.abs(Math.abs(pos.x) - 0.8283);
    
    // Distance to vertical boundaries
    const dy1 = Math.abs(pos.y - (p.sz_bot - 0.12));
    const dy2 = Math.abs(pos.y - (p.sz_top + 0.12));
    const dy = Math.min(dy1, dy2);
    
    // Total boundary distance
    // If it is inside horizontally, the distance is dy. If inside vertically, dx.
    // If outside both, it is sqrt(dx^2 + dy^2).
    // Let's compute standard distance to the strike zone box boundaries:
    const inX = Math.abs(pos.x) <= 0.8283;
    const inY = pos.y >= p.sz_bot - 0.12 && pos.y <= p.sz_top + 0.12;
    
    let dist = 0;
    if (inX && inY) {
      // Inside: shortest distance to any of the 4 borders
      dist = Math.min(dx, dy);
    } else if (inX) {
      // Outside vertically only
      dist = dy;
    } else if (inY) {
      // Outside horizontally only
      dist = dx;
    } else {
      // Outside both (corner regions)
      dist = Math.sqrt(dx*dx + dy*dy);
    }
    
    list.push({
      pitch: p,
      gameTitle: game.title,
      pos,
      dist,
      dx,
      dy
    });
  });
});

list.sort((a, b) => a.dist - b.dist);

console.log("TOP 15 CLOSEST PITCHES TO BORDER:");
list.slice(0, 15).forEach((item, idx) => {
  console.log(`[${idx+1}] Dist: ${item.dist.toFixed(5)} ft (${(item.dist * 12).toFixed(2)} in) | Game: ${item.gameTitle} | P: ${item.pitch.pitcher} vs B: ${item.pitch.batter} | Type: ${item.pitch.pitch_type} | ABS: ${item.pitch.abs_call || item.pitch.real_ump_call} | Swing: ${item.pitch.is_swing ? 'YES' : 'NO'}`);
});
