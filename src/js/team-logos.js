/** MLB team name → logo id for mlbstatic.com SVGs */

const TEAM_LOGO_IDS = {
  dbacks: 109,
  braves: 144,
  orioles: 110,
  'red sox': 111,
  cubs: 112,
  'white sox': 145,
  reds: 113,
  guardians: 114,
  rockies: 115,
  tigers: 116,
  astros: 117,
  royals: 118,
  angels: 108,
  dodgers: 119,
  marlins: 146,
  brewers: 158,
  twins: 142,
  mets: 121,
  yankees: 147,
  athletics: 133,
  phillies: 143,
  pirates: 134,
  padres: 135,
  giants: 137,
  mariners: 136,
  cardinals: 138,
  rays: 139,
  rangers: 140,
  'blue jays': 141,
  nationals: 120,
};

// Map of common team name variations to canonical names
const TEAM_ALIASES = {
  'arizona': 'dbacks',
  'diamondbacks': 'dbacks',
  'atlanta': 'braves',
  'baltimore': 'orioles',
  'boston': 'red sox',
  'chicago cubs': 'cubs',
  'chicago white': 'white sox',
  'cincinnati': 'reds',
  'cleveland': 'guardians',
  'colorado': 'rockies',
  'detroit': 'tigers',
  'houston': 'astros',
  'kansas city': 'royals',
  'los angeles angels': 'angels',
  'los angeles dodgers': 'dodgers',
  'miami': 'marlins',
  'milwaukee': 'brewers',
  'minnesota': 'twins',
  'new york mets': 'mets',
  'new york yankees': 'yankees',
  'oakland': 'athletics',
  'philadelphia': 'phillies',
  'pittsburgh': 'pirates',
  'san diego': 'padres',
  'san francisco': 'giants',
  'seattle': 'mariners',
  'st. louis': 'cardinals',
  'st louis': 'cardinals',
  'tampa bay': 'rays',
  'texas': 'rangers',
  'toronto': 'blue jays',
  'washington': 'nationals',
};

export function getTeamLogoUrl(teamName) {
  if (!teamName) return '/generic.svg';

  // Normalize input
  const normName = String(teamName)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  // First try exact match with aliases
  const aliased = TEAM_ALIASES[normName];
  if (aliased && TEAM_LOGO_IDS[aliased]) {
    return `https://www.mlbstatic.com/team-logos/${TEAM_LOGO_IDS[aliased]}.svg`;
  }

  // Then try substring matching in aliases
  for (const [alias, canonical] of Object.entries(TEAM_ALIASES)) {
    if (normName.includes(alias) || alias.includes(normName)) {
      const logoId = TEAM_LOGO_IDS[canonical];
      if (logoId) {
        return `https://www.mlbstatic.com/team-logos/${logoId}.svg`;
      }
    }
  }

  // Fall back to direct team name matching
  const directMatch = TEAM_LOGO_IDS[normName.replace(/\s+/g, '')];
  if (directMatch) {
    return `https://www.mlbstatic.com/team-logos/${directMatch}.svg`;
  }

  // Last resort: substring match in direct IDs
  for (const [key, value] of Object.entries(TEAM_LOGO_IDS)) {
    const normKey = key.replace(/\s+/g, '');
    if (normName.replace(/\s+/g, '').includes(normKey) || normKey.includes(normName.replace(/\s+/g, ''))) {
      return `https://www.mlbstatic.com/team-logos/${value}.svg`;
    }
  }

  return '/generic.svg';
}
