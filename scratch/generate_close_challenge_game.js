import fs from 'fs';

const sz_bot = 1.6;
const sz_top = 3.4;
const PLATE_MIDPOINT_Z = 0.7083;

const PITCHERS = {
  "Corbin Burnes": { hand: "RHP", rx: -1.7, ry: 50.6, rz: 6.1, ay: 26.5 },
  "Tarik Skubal": { hand: "LHP", rx: 1.7, ry: 50.4, rz: 5.9, ay: 25.5 },
  "Gerrit Cole": { hand: "RHP", rx: -2.0, ry: 50.6, rz: 5.9, ay: 27.0 },
  "Zack Wheeler": { hand: "RHP", rx: -1.6, ry: 50.8, rz: 6.2, ay: 26.5 },
  "Nathan Eovaldi": { hand: "RHP", rx: -1.8, ry: 50.7, rz: 5.8, ay: 26.8 },
  "Framber Valdez": { hand: "LHP", rx: 1.8, ry: 50.5, rz: 5.8, ay: 25.0 }
};

const PROFILES = {
  "RHP_Fastball": { ax: 6.0, az: -16.0, speed: 95.0 },
  "RHP_Sinker": { ax: 12.0, az: -21.0, speed: 94.0 },
  "RHP_Slider": { ax: -9.0, az: -27.0, speed: 84.0 },
  "LHP_Sinker": { ax: -11.0, az: -21.0, speed: 94.0 },
  "LHP_Slider": { ax: 9.0, az: -27.0, speed: 84.0 },
  "LHP_Curveball": { ax: 7.5, az: -35.0, speed: 78.0 },
  "LHP_Fastball": { ax: -5.5, az: -16.0, speed: 93.0 }
};

function solvePitch({ id, inning, is_top, pitcherName, batter, batter_hand, pitchType, targetX, targetY, real_ump_call, abs_call, is_critical, blurb, is_swing, swing_outcome, swing_hit_type, score_away, score_home, outs, runners }) {
  const pData = PITCHERS[pitcherName];
  if (!pData) throw new Error("Pitcher not found: " + pitcherName);
  
  const pHand = pData.hand;
  let profileKey = `${pHand}_${pitchType}`;
  if (!PROFILES[profileKey]) {
    profileKey = pHand === "RHP" ? "RHP_Fastball" : "LHP_Fastball";
  }
  const profile = PROFILES[profileKey];
  
  const x0 = pData.rx;
  const y0 = pData.ry;
  const z0 = pData.rz;
  const ax = profile.ax;
  const ay = pData.ay;
  const az = profile.az;
  const speed = profile.speed;
  
  const V_release = speed * 1.4667;
  const vy0 = -V_release * 0.99;
  
  const a = 0.5 * ay;
  const b = vy0;
  const c = y0 - PLATE_MIDPOINT_Z;
  const desc = b * b - 4 * a * c;
  const t_cross = (-b - Math.sqrt(desc)) / (2 * a);
  
  // Notice: in getBallPositionAtTime, Three.js X = -Statcast X.
  // So to land at targetX, the Statcast X crossing value must be -targetX.
  const vx0 = (-targetX - x0 - 0.5 * ax * t_cross * t_cross) / t_cross;
  const vz0 = (targetY - z0 - 0.5 * az * t_cross * t_cross) / t_cross;
  
  return {
    id,
    inning,
    is_top,
    pitcher: pitcherName,
    pitcher_hand: pHand,
    batter,
    batter_hand,
    pitch_type: pitchType,
    speed_mph: speed,
    release_pos_x: Number(x0.toFixed(3)),
    release_pos_y: Number(y0.toFixed(3)),
    release_pos_z: Number(z0.toFixed(3)),
    vx0: Number(vx0.toFixed(3)),
    vy0: Number(vy0.toFixed(3)),
    vz0: Number(vz0.toFixed(3)),
    ax: Number(ax.toFixed(3)),
    ay: Number(ay.toFixed(3)),
    az: Number(az.toFixed(3)),
    sz_top,
    sz_bot,
    real_ump_call,
    abs_call,
    is_critical: !!is_critical,
    historical_blurb: blurb,
    is_swing: !!is_swing,
    swing_outcome: swing_outcome || null,
    swing_hit_type: swing_hit_type || null,
    score_away: score_away !== undefined ? score_away : 0,
    score_home: score_home !== undefined ? score_home : 0,
    outs: outs !== undefined ? outs : 0,
    runners: runners || [0, 0, 0]
  };
}

const pitchersList = Object.keys(PITCHERS);
const battersList = [
  { name: "Aaron Judge", hand: "RHB" },
  { name: "Juan Soto", hand: "LHB" },
  { name: "Gunnar Henderson", hand: "LHB" },
  { name: "Shohei Ohtani", hand: "LHB" },
  { name: "Francisco Lindor", hand: "LHB" },
  { name: "Alex Bregman", hand: "RHB" }
];

const pitches = [];
let currentId = 9001;

// We will generate 5 At-Bats of 3 pitches each (total 15 pitches).
// Every single pitch will be a taken borderline pitch.
// We will alternate the batters to create distinct At-Bats.
for (let ab = 0; ab < 5; ab++) {
  const batter = battersList[ab % battersList.length];
  const pitcher = pitchersList[ab % pitchersList.length];
  const isTop = ab % 2 === 0;
  
  for (let pIdx = 0; pIdx < 3; pIdx++) {
    // Generate an extremely close borderline target crossing point
    // Zone width: -0.8283 to 0.8283
    // Zone height: sz_bot - 0.12 (1.48) to sz_top + 0.12 (3.52)
    const isHorizontalEdge = Math.random() > 0.5;
    const isStrike = Math.random() > 0.5;
    
    let targetX = 0;
    let targetY = 0;
    
    // Choose offset epsilon: between -0.03 and +0.03 feet (less than 0.36 inches from boundary!)
    const epsilon = (Math.random() * 0.05) - 0.025;
    
    if (isHorizontalEdge) {
      // Near left or right border
      const borderX = Math.random() > 0.5 ? 0.8283 : -0.8283;
      // If it's a strike, push it slightly inside the border, otherwise slightly outside
      const dir = borderX > 0 ? -1 : 1;
      targetX = borderX + (isStrike ? dir * Math.abs(epsilon) : -dir * Math.abs(epsilon));
      // Keep Y safely inside the vertical zone
      targetY = sz_bot + 0.3 + Math.random() * (sz_top - sz_bot - 0.6);
    } else {
      // Near top or bottom border
      const borderY = Math.random() > 0.5 ? 3.52 : 1.48;
      const dir = borderY > 2.5 ? -1 : 1;
      targetY = borderY + (isStrike ? dir * Math.abs(epsilon) : -dir * Math.abs(epsilon));
      // Keep X safely inside the horizontal zone
      targetX = (Math.random() - 0.5) * 1.2;
    }
    
    // Determine ABS call
    // A pitch is a strike if |x| <= 0.8283 and y >= 1.48 and y <= 3.52
    const absCall = (Math.abs(targetX) <= 0.8283 && targetY >= 1.48 && targetY <= 3.52) ? "S" : "B";
    
    // Human umpire makes mistakes on 40% of these extremely close pitches
    const isUmpCorrect = Math.random() > 0.4;
    const realUmpCall = isUmpCorrect ? absCall : (absCall === "S" ? "B" : "S");
    
    // Repertoire pitch types
    const pHand = PITCHERS[pitcher].hand;
    const pitchType = pHand === "RHP" ? "Fastball" : "Sinker";
    
    const callText = absCall === "S" ? "STRIKE" : "BALL";
    const blurb = `${pitcher} throws a painting ${pitchType} on the edge. ${batter.name} takes, and ABS confirms it crossed as a called ${callText} by a hair!`;
    
    const solved = solvePitch({
      id: currentId++,
      inning: Math.floor(ab / 2) + 1,
      is_top: isTop,
      pitcherName: pitcher,
      batter: batter.name,
      batter_hand: batter.hand,
      pitchType,
      targetX,
      targetY,
      real_ump_call: realUmpCall,
      abs_call: absCall,
      is_critical: true,
      blurb,
      is_swing: false,
      score_away: isTop ? 1 : 0,
      score_home: isTop ? 0 : 1,
      outs: ab % 3,
      runners: [ab % 2, (ab + 1) % 2, 0]
    });
    
    pitches.push(solved);
  }
}

const gameData = {
  "id": "game_6",
  "title": "ABS Borderline Showdown",
  "description": "Weekly Daily Challenge. Curated compilation of the absolute closest, most difficult edge calls.",
  "film_room_url": "https://www.mlb.com/video",
  "ump_scorecard_url": "https://umpscorecards.com",
  "pitches": pitches
};

fs.writeFileSync('src/data/close_challenge.js', `export const CLOSE_CHALLENGE_DATA = ${JSON.stringify(gameData, null, 2)};\n`);
console.log("Successfully generated close challenge game with 15 pitches!");
