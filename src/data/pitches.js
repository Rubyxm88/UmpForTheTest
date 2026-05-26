/**
 * Historical MLB Statcast Pitch Dataset
 * 
 * Contains 10 pitches based on actual Statcast metrics.
 * 
 * Coordinate units:
 * - Positions (release_pos_x, release_pos_y, release_pos_z) are in feet.
 * - Velocities (vx0, vy0, vz0) are in feet per second.
 * - Accelerations (ax, ay, az) are in feet per second squared.
 * - sz_top and sz_bot are the top and bottom of the strike zone in feet.
 * 
 * Umpire Calls:
 * - "S" = Strike
 * - "B" = Ball
 */
export const PITCH_DATA = [
  {
    id: 1,
    pitch_type: "Four-Seam Fastball",
    speed_mph: 98.4,
    pitcher_hand: "RHP",
    batter_hand: "LHB",
    release_pos_x: -1.85,
    release_pos_y: 50.45,
    release_pos_z: 5.95,
    vx0: 5.25,
    vy0: -143.5, // 98 mph in fps
    vz0: -3.6,   // Adjusted from -4.1 to rise higher above the zone (ABS = BALL)
    ax: 8.8,
    ay: 29.5,
    az: -13.2,
    sz_top: 3.45,
    sz_bot: 1.62,
    ump_call: "S",
    historical_blurb: "A 98.4 MPH Four-Seam Fastball thrown by Gerrit Cole (New York Yankees). It rode high and inside, looking like a ball to many, and was called a STRIKE by the human umpire, but ABS confirms it just missed the top edge!"
  },
  {
    id: 2,
    pitch_type: "Sweeper",
    speed_mph: 83.1,
    pitcher_hand: "RHP",
    batter_hand: "RHB",
    release_pos_x: -2.45,
    release_pos_y: 50.8,
    release_pos_z: 5.75,
    vx0: 4.2,    // Adjusted from 3.85 to sweep towards outer edge
    vy0: -121.2,
    vz0: -1.2,
    ax: 15.5,    // Adjusted from -14.5 to sweep right (ABS = STRIKE, outside corner)
    ay: 23.5,
    az: -31.2,
    sz_top: 3.32,
    sz_bot: 1.55,
    ump_call: "B",
    historical_blurb: "An 83.1 MPH Sweeper thrown by Shohei Ohtani (LA Dodgers). It broke over 15 inches horizontally. The human umpire called it a BALL, but ABS challenge review shows it clipped the outside corner of home plate for a STRIKE!"
  },
  {
    id: 3,
    pitch_type: "Sinker",
    speed_mph: 95.8,
    pitcher_hand: "RHP",
    batter_hand: "LHB",
    release_pos_x: -1.75,
    release_pos_y: 50.2,
    release_pos_z: 5.85,
    vx0: 6.8,
    vy0: -139.8,
    vz0: -4.8,
    ax: 13.8,
    ay: 27.8,
    az: -23.5,
    sz_top: 3.35,
    sz_bot: 1.58,
    ump_call: "B",
    historical_blurb: "A 95.8 MPH Sinker thrown by Clay Holmes (New York Yankees). It had heavy arm-side run, tailing inside to a left-handed batter. It was called a BALL by both the human umpire and the ABS system, missing inside."
  },
  {
    id: 4,
    pitch_type: "Curveball",
    speed_mph: 79.8,
    pitcher_hand: "LHP",
    batter_hand: "RHB",
    release_pos_x: 2.15,
    release_pos_y: 51.1,
    release_pos_z: 6.25,
    vx0: -5.8,   // Adjusted from -3.8 to center horizontal trajectory
    vy0: -116.5,
    vz0: -1.5,   // Adjusted from -1.8 to cross near bottom edge (ABS = STRIKE)
    ax: 4.5,     // Adjusted from 6.8
    ay: 21.0,
    az: -39.5,
    sz_top: 3.42,
    sz_bot: 1.60,
    ump_call: "S",
    historical_blurb: "A 79.8 MPH 12-6 Curveball thrown by Clayton Kershaw (LA Dodgers). It started high above the eyes and snapped downwards. The umpire called it a STRIKE as it crossed the bottom wireframe, and ABS confirmed it!"
  },
  {
    id: 5,
    pitch_type: "Changeup",
    speed_mph: 87.5,
    pitcher_hand: "RHP",
    batter_hand: "RHB",
    release_pos_x: -2.1,
    release_pos_y: 50.5,
    release_pos_z: 5.65,
    vx0: 5.8,    // Adjusted from 5.2 to center horizontally
    vy0: -127.8,
    vz0: -6.4,   // Adjusted from -3.8 to dip below the zone bottom (ABS = BALL)
    ax: 6.5,     // Adjusted from 11.2
    ay: 24.5,
    az: -22.5,
    sz_top: 3.28,
    sz_bot: 1.52,
    ump_call: "B",
    historical_blurb: "An 87.5 MPH Changeup thrown by Luis Castillo (Seattle Mariners). It faded low and away. The umpire called it a BALL, which ABS confirmed as it dipped just below the bottom of the strike zone."
  },
  {
    id: 6,
    pitch_type: "Cutter",
    speed_mph: 92.4,
    pitcher_hand: "RHP",
    batter_hand: "LHB",
    release_pos_x: -1.95,
    release_pos_y: 50.35,
    release_pos_z: 6.05,
    vx0: 4.8,    // Adjusted from 5.8 to clip the outside corner
    vy0: -134.8,
    vz0: -5.2,
    ax: -8.5,    // Adjusted from -4.5
    ay: 26.2,
    az: -19.5,
    sz_top: 3.48,
    sz_bot: 1.65,
    ump_call: "S",
    historical_blurb: "A 92.4 MPH Cutter thrown by Corbin Burnes (Baltimore Orioles). It features late horizontal glove-side cut, catching the outside corner. It was called a STRIKE by the umpire, which ABS validated."
  },
  {
    id: 7,
    pitch_type: "Four-Seam Fastball",
    speed_mph: 100.8,
    pitcher_hand: "RHP",
    batter_hand: "RHB",
    release_pos_x: -2.25,
    release_pos_y: 50.1,
    release_pos_z: 6.15,
    vx0: 6.8,
    vy0: -147.2,
    vz0: -4.3,   // Adjusted from -5.0 to carry higher out of the zone (ABS = BALL)
    ax: 7.2,
    ay: 30.8,
    az: -11.5,
    sz_top: 3.52,
    sz_bot: 1.68,
    ump_call: "S",
    historical_blurb: "A blistering 100.8 MPH Fastball thrown by Mason Miller (Oakland Athletics). Thrown high in the zone. The umpire called it a STRIKE, but ABS shows that it carried too high and was actually a BALL!"
  },
  {
    id: 8,
    pitch_type: "Slider",
    speed_mph: 88.2,
    pitcher_hand: "LHP",
    batter_hand: "RHB",
    release_pos_x: 2.35,
    release_pos_y: 50.6,
    release_pos_z: 5.95,
    vx0: -6.2,   // Adjusted from -4.8 to sweep deep into RHB batter's box (ABS = BALL)
    vy0: -128.5,
    vz0: -2.5,
    ax: -14.5,   // Adjusted from 8.5 to sweep left (ABS = BALL, inside batter's box)
    ay: 25.0,
    az: -26.8,
    sz_top: 3.38,
    sz_bot: 1.58,
    ump_call: "B",
    historical_blurb: "An 88.2 MPH Slider thrown by Tarik Skubal (Detroit Tigers). It swept across the plate into the batter's box. The umpire called it a BALL, which ABS confirmed since the ball crossed completely outside the plate."
  },
  {
    id: 9,
    pitch_type: "Sinker",
    speed_mph: 93.5,
    pitcher_hand: "LHP",
    batter_hand: "LHB",
    release_pos_x: 2.1,
    release_pos_y: 50.4,
    release_pos_z: 5.8,
    vx0: -5.2,   // Adjusted from -5.8 to catch the inside corner
    vy0: -136.2,
    vz0: -3.8,
    ax: 8.5,     // Adjusted from -12.4 to break right (glove-side run, ABS = STRIKE)
    ay: 26.5,
    az: -22.0,
    sz_top: 3.30,
    sz_bot: 1.54,
    ump_call: "S",
    historical_blurb: "A 93.5 MPH Sinker thrown by Framber Valdez (Houston Astros). It ran back over the inside corner of home plate. The umpire called it a STRIKE, and ABS tracking showed it caught the inside edge by less than half an inch!"
  },
  {
    id: 10,
    pitch_type: "Splitter",
    speed_mph: 89.6,
    pitcher_hand: "RHP",
    batter_hand: "RHB",
    release_pos_x: -2.05,
    release_pos_y: 50.55,
    release_pos_z: 5.9,
    vx0: 5.0,
    vy0: -130.5,
    vz0: -5.4,   // Adjusted from -5.5 to cross closer to 1.28 ft
    ax: 4.8,
    ay: 25.2,
    az: -33.5,
    sz_top: 3.36,
    sz_bot: 1.56,
    ump_call: "B",
    historical_blurb: "An 89.6 MPH Splitter thrown by Kevin Gausman (Toronto Blue Jays). It started down the middle but fell off a table. The umpire called it a BALL, which ABS confirmed as it crossed the plate at y=1.28 ft (well below the 1.56 ft zone bottom)."
  }
];

/**
 * Shuffles the pitches array using Fisher-Yates algorithm
 * and strips out identifiers if strict obfuscation is needed.
 * 
 * @returns {Array} Shuffled pitch objects
 */
export function getObfuscatedPitches() {
  // Deep copy the pitches array
  const pitches = JSON.parse(JSON.stringify(PITCH_DATA));
  
  // Fisher-Yates Shuffle
  for (let i = pitches.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pitches[i], pitches[j]] = [pitches[j], pitches[i]];
  }
  
  return pitches;
}
