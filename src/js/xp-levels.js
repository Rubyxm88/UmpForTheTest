/** XP progression — CoD-style tier badges (long-run level curve) */

export const XP_PER_LEVEL = 1000;

/** Milestone tiers: each tier covers a level range with distinct badge styling */
export const LEVEL_TIERS = [
  { min: 1, max: 4, title: 'Rookie Umpire', short: 'ROOKIE', tier: 'rookie' },
  { min: 5, max: 9, title: 'Line Umpire', short: 'LINE', tier: 'line' },
  { min: 10, max: 14, title: 'Crew Regular', short: 'REGULAR', tier: 'regular' },
  { min: 15, max: 19, title: 'Veteran Crew', short: 'VETERAN', tier: 'veteran' },
  { min: 20, max: 29, title: 'Crew Chief', short: 'CHIEF', tier: 'chief' },
  { min: 30, max: 39, title: 'Division Supervisor', short: 'DIVISION', tier: 'division' },
  { min: 40, max: 49, title: 'League Official', short: 'LEAGUE', tier: 'league' },
  { min: 50, max: 59, title: 'World Series Crew', short: 'WS CREW', tier: 'worldseries' },
  { min: 60, max: 74, title: 'Elite Arbiter', short: 'ELITE', tier: 'elite' },
  { min: 75, max: 99, title: 'Master Umpire', short: 'MASTER', tier: 'master' },
  { min: 100, max: Infinity, title: 'Hall of Fame', short: 'HOF', tier: 'hof' },
];

export function getLevelFromXp(xp) {
  const safe = Math.max(0, xp || 0);
  return Math.floor(safe / XP_PER_LEVEL) + 1;
}

export function getXpProgressInLevel(xp) {
  const level = getLevelFromXp(xp);
  const base = (level - 1) * XP_PER_LEVEL;
  const progress = Math.max(0, (xp || 0) - base);
  const pct = Math.min(100, Math.round((progress / XP_PER_LEVEL) * 100));
  return { level, progress, pct, base, nextAt: base + XP_PER_LEVEL };
}

export function getLevelTier(level) {
  const lv = Math.max(1, level || 1);
  return LEVEL_TIERS.find((t) => lv >= t.min && lv <= t.max) || LEVEL_TIERS[LEVEL_TIERS.length - 1];
}

export function isMilestoneLevel(level) {
  if (level <= 1) return false;
  const milestones = [5, 10, 15, 20, 30, 40, 50, 60, 75, 100];
  return milestones.includes(level);
}

export function formatLevelLabel(level) {
  const tier = getLevelTier(level);
  return `LVL ${level} · ${tier.short}`;
}

export function getAbXpBreakdown(correctCount, isPerfect) {
  const pitchXp = Math.max(0, correctCount) * 10;
  const bonusXp = isPerfect && correctCount > 0 ? 50 : 0;
  return { pitchXp, bonusXp, total: pitchXp + bonusXp };
}

/** Apply unified XP bar fill to any bar element */
export function setXpBarPercent(barEl, pct, animate = true) {
  if (!barEl) return;
  barEl.style.transition = animate ? 'width 1s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none';
  barEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  
  if (animate) {
    barEl.classList.remove('xp-gained');
    barEl.offsetHeight; // force reflow
    barEl.classList.add('xp-gained');
    
    if (barEl._xpTimer) clearTimeout(barEl._xpTimer);
    barEl._xpTimer = setTimeout(() => {
      barEl.classList.remove('xp-gained');
      delete barEl._xpTimer;
    }, 2500);
  }
}

export function applyLevelBadgeElement(el, level, options = {}) {
  if (!el) return;
  const tier = getLevelTier(level);
  const compact = options.compact === true;
  el.textContent = compact ? `LV ${level}` : formatLevelLabel(level);
  el.classList.remove(
    'ump-level-badge',
    'ump-level-badge--rookie', 'ump-level-badge--line', 'ump-level-badge--regular',
    'ump-level-badge--veteran', 'ump-level-badge--chief', 'ump-level-badge--division',
    'ump-level-badge--league', 'ump-level-badge--worldseries', 'ump-level-badge--elite',
    'ump-level-badge--master', 'ump-level-badge--hof'
  );
  el.classList.add('ump-level-badge', `ump-level-badge--${tier.tier}`);
  if (isMilestoneLevel(level)) {
    el.classList.add('ump-level-badge--milestone');
  } else {
    el.classList.remove('ump-level-badge--milestone');
  }
  el.title = tier.title;
}
