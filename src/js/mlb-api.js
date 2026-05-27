/**
 * MLB Stats API Integration Module
 * Fetches real game data from statsapi.mlb.com for Daily Compete mode.
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

/**
 * Map MLB API call code to our app format
 */
function mapCallCode(code) {
  switch (code) {
    case 'C': return 'S'; // Called Strike
    case 'S': return 'S'; // Swinging Strike
    case 'F': return 'S'; // Foul
    case 'X': return 'S'; // In Play (treat as strike for ump call purposes)
    case 'B': return 'B'; // Ball
    case 'W': return 'B'; // Intentional Ball
    case 'H': return 'B'; // Hit By Pitch
    default: return 'B';
  }
}

/**
 * Determine if a pitch was a swing
 */
function isSwingPitch(callCode) {
  return ['S', 'F', 'X'].includes(callCode);
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

/**
 * Map MLB event type to our swing outcome format
 */
function mapSwingOutcome(eventType) {
  if (!eventType) return { outcome: null, hitType: null };

  const lower = eventType.toLowerCase();
  
  // Hits
  if (lower === 'single') return { outcome: 'HIT', hitType: 'SINGLE' };
  if (lower === 'double') return { outcome: 'HIT', hitType: 'DOUBLE' };
  if (lower === 'triple') return { outcome: 'HIT', hitType: 'TRIPLE' };
  if (lower === 'home_run') return { outcome: 'HIT', hitType: 'HOMERUN' };

  // Outs
  if (lower.includes('strikeout')) return { outcome: 'WHIFF', hitType: null };
  if (lower === 'field_out' || lower === 'force_out' || lower === 'double_play' ||
      lower === 'grounded_into_double_play' || lower === 'fielders_choice' ||
      lower === 'fielders_choice_out' || lower === 'sac_fly' || lower === 'sac_bunt') {
    return { outcome: 'OUT', hitType: 'FLYOUT' };
  }

  return { outcome: null, hitType: null };
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
 * Fetch full play-by-play data for a game and parse it into our pitch format.
 * @param {number} gamePk - MLB game ID
 * @returns {Promise<Array>} Array of at-bat arrays (each containing pitch objects)
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

    const allPitches = [];
    let pitchIdCounter = 30000;

    allPlays.forEach((play, playIdx) => {
      if (!play.playEvents || !play.matchup) return;

      const pitcher = play.matchup.pitcher?.fullName || 'Unknown Pitcher';
      const batter = play.matchup.batter?.fullName || 'Unknown Batter';
      const pitchHand = play.matchup.pitchHand?.code === 'L' ? 'LHP' : 'RHP';
      const batSide = play.matchup.batSide?.code === 'L' ? 'LHB' : 'RHB';
      const inning = play.about?.inning || 1;
      const isTop = play.about?.isTopInning ?? true;

      const abResult = play.result?.eventType || '';
      const abEvent = play.result?.event || '';
      const abDescription = play.result?.description || '';

      // Get runners and score from play context
      const scoreAway = play.result?.awayScore ?? 0;
      const scoreHome = play.result?.homeScore ?? 0;

      const pitchEvents = play.playEvents.filter(e => e.isPitch === true);

      pitchEvents.forEach((pitchEvent, pIdx) => {
        const pd = pitchEvent.pitchData;
        const details = pitchEvent.details;
        if (!pd || !details) return;

        const coords = pd.coordinates || {};
        const callCode = details.call?.code || 'B';
        const isLast = pIdx === pitchEvents.length - 1;

        // Determine swing info
        const isSwing = isSwingPitch(callCode);
        let swingOutcome = null;
        let swingHitType = null;

        if (isLast) {
          const mapped = mapSwingOutcome(abResult);
          swingOutcome = mapped.outcome;
          swingHitType = mapped.hitType;

          // Refine hit type from event description
          if (swingHitType === 'FLYOUT' && abEvent) {
            const evLower = abEvent.toLowerCase();
            if (evLower.includes('ground')) swingHitType = 'GROUNDOUT';
            else if (evLower.includes('line')) swingHitType = 'LINEOUT';
            else if (evLower.includes('pop')) swingHitType = 'FLYOUT';
          }
        }

        // Calculate absolute correct call
        const pX = coords.pX ?? 0;
        const pZ = coords.pZ ?? 2.5;
        const szTop = pd.strikeZoneTop ?? 3.4;
        const szBot = pd.strikeZoneBottom ?? 1.6;
        const absCall = calculateAbsCall(pX, pZ, szTop, szBot);

        // Build blurb
        const pitchType = mapPitchType(details.type?.description, details.type?.code);
        let blurb = '';
        if (isLast && swingOutcome === 'HIT') {
          blurb = `${batter} ${abEvent ? abEvent.toLowerCase() : 'hits'} off ${pitcher}'s ${pitchType}!`;
        } else if (isLast && swingOutcome === 'WHIFF') {
          blurb = `${batter} strikes out swinging on ${pitcher}'s ${pitchType}!`;
        } else if (isLast && swingOutcome === 'OUT') {
          blurb = `${batter} ${abEvent ? abEvent.toLowerCase() : 'makes an out'} on a ${pitchType}.`;
        } else if (isSwing) {
          blurb = `${batter} swings at ${pitcher}'s ${pitchType}.`;
        } else {
          const callDesc = mapCallCode(callCode) === 'S' ? 'called STRIKE' : 'called BALL';
          blurb = `${pitcher} throws a ${pitchType}. ${batter} takes for a ${callDesc}.`;
        }

        const count = pitchEvent.count || {};
        const outs = count.outs ?? 0;

        allPitches.push({
          id: pitchIdCounter++,
          inning,
          is_top: isTop,
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
          abs_call: absCall,
          is_critical: false,
          historical_blurb: blurb,
          is_swing: isSwing,
          swing_outcome: isLast ? swingOutcome : null,
          swing_hit_type: isLast ? swingHitType : null,
          score_away: scoreAway,
          score_home: scoreHome,
          outs,
          runners: [0, 0, 0] // Simplified — real runner state would need more parsing
        });
      });
    });

    // Group pitches into at-bats (condensed: pick ~15 representative at-bats)
    const atBats = [];
    let currentAB = [];
    let lastBatter = null;

    allPitches.forEach(p => {
      if (lastBatter && p.batter !== lastBatter && currentAB.length > 0) {
        atBats.push([...currentAB]);
        currentAB = [];
      }
      currentAB.push(p);
      lastBatter = p.batter;
    });
    if (currentAB.length > 0) atBats.push(currentAB);

    // Select up to 15 at-bats spread across the game
    let selectedABs;
    if (atBats.length <= 15) {
      selectedABs = atBats;
    } else {
      const step = atBats.length / 15;
      selectedABs = [];
      for (let i = 0; i < 15; i++) {
        selectedABs.push(atBats[Math.floor(i * step)]);
      }
    }

    return selectedABs;
  } catch (err) {
    console.warn('MLB API: Failed to fetch game pitches:', err);
    return null;
  }
}
