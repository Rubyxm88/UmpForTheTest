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

export function getTeamLogoUrl(teamName) {
  const normName = String(teamName || '')
    .toLowerCase()
    .replace('.', '')
    .trim();
  for (const [key, value] of Object.entries(TEAM_LOGO_IDS)) {
    if (normName.includes(key) || key.includes(normName)) {
      return `https://www.mlbstatic.com/team-logos/${value}.svg`;
    }
  }
  return '/generic.svg';
}
