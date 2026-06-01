/**
 * MLB Play Any Game — recent games grid, date finder, cache, preview modal, build overlay.
 */

import {
  fetchAllGamesForDate,
  fetchGamePitches,
  formatLocalDateString,
  getDefaultBrowseDate,
  MLB_GAME_FEED_PARSE_VERSION,
} from './mlb-api.js';
import {
  initGameFinderCalendar,
  setGameFinderCalendarDate,
  getGameFinderCalendarDate,
  closeCalendarPopover,
} from './mlb-game-calendar.js';
import {
  getCachedGame,
  saveCachedGame,
  pruneGameCache,
  GAME_CACHE_MAX_AGE_MS,
} from './db.js';
import { getTeamLogoUrl } from './team-logos.js';
import {
  initPreviewHub,
  populatePreviewModal,
  clearPreviewState,
  setPreviewGameHeader,
  collapsePreviewGameDetails,
} from './mlb-games-preview.js';

let deps = null;
const DATE_GAMES_TTL_MS = 5 * 60 * 1000;
const dateGamesCache = new Map();
let browseLoadRequestId = 0;
let browseLoadStatusTimer = null;
const MLB_PLAY_RETURN_KEY = 'mlb_play_return';

/** In-memory only — cleared on full page reload (not sessionStorage). */
let browseDateIso = null;

function parseIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getQuickOffsetForIso(iso) {
  if (!iso) return null;
  const today = parseIsoDate(formatLocalDateString(new Date()));
  const target = parseIsoDate(iso);
  const diffDays = Math.round((today - target) / 86400000);
  if (diffDays >= 0 && diffDays <= 2) return -diffDays;
  return null;
}

export function setActiveQuickChip(offset) {
  document.querySelectorAll('[data-game-finder-offset]').forEach((btn) => {
    const btnOffset = Number(btn.getAttribute('data-game-finder-offset') || 0);
    const active = offset !== null && btnOffset === offset;
    btn.classList.toggle('mlb-games-quick-chip--active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function syncQuickChipHighlight() {
  setActiveQuickChip(getQuickOffsetForIso(getGameFinderCalendarDate()));
}

function setBrowseToDefault() {
  const d = getDefaultBrowseDate();
  browseDateIso = formatLocalDateString(d);
  setGameFinderCalendarDate(d);
  syncQuickChipHighlight();
}

function emptyGamesMessage(dateStr) {
  if (dateStr === formatLocalDateString()) {
    return "No games yet today. Use Yesterday for last night's slate.";
  }
  return 'No games found for this period. Try another day or check back after first pitch.';
}

export function initMlbGamesModule(moduleDeps) {
  deps = moduleDeps;
  setBrowseToDefault();
  sessionStorage.removeItem(MLB_PLAY_RETURN_KEY);
  pruneGameCache().catch((e) => console.warn('Game cache prune failed:', e));
  initGameFinderCalendar({ onDateSelected: () => handleFindGames() });
  bindQuickDateButtons();
  initPreviewHub(deps);
  initPreviewDismiss(deps);
  initPreviewModeTabs();
}

function liveDotMarkup() {
  return '<span class="mlb-live-dot" title="Live" aria-label="Live game"></span>';
}

function initPreviewModeTabs() {
  const tabs = document.getElementById('preview-mode-tabs');
  const modes = document.querySelector('.game-preview-panel__modes');
  if (!tabs || !modes) return;

  const setMode = (mode) => {
    tabs.querySelectorAll('[data-preview-mode]').forEach((btn) => {
      const active = btn.dataset.previewMode === mode;
      btn.classList.toggle('game-preview-mode-tab--active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    modes.dataset.activeMode = mode;
  };

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preview-mode]');
    if (!btn) return;
    setMode(btn.dataset.previewMode);
  });

  setMode('quick');
}

function initPreviewDismiss(deps) {
  const overlay = deps.previewModalOverlay;
  const panel = deps.previewModalPanel;
  if (!overlay || !deps.hidePreviewModal) return;

  panel?.addEventListener('click', (e) => e.stopPropagation());

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) deps.hidePreviewModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!overlay.classList.contains('opacity-100')) return;
    deps.hidePreviewModal();
  });
}

function getEl(id) {
  return document.getElementById(id);
}

export function setGameFinderDate(date) {
  setGameFinderCalendarDate(date);
}

function getGameFinderSelectedDate() {
  return getGameFinderCalendarDate();
}

function getLoadStatusEl() {
  return document.getElementById('game-finder-load-status');
}

function clearBrowseLoadStatusTimer() {
  if (browseLoadStatusTimer) {
    clearTimeout(browseLoadStatusTimer);
    browseLoadStatusTimer = null;
  }
}

function showBrowseLoadStatus(message, { fadeAfterMs = 0 } = {}) {
  const el = getLoadStatusEl();
  if (!el) return;
  clearBrowseLoadStatusTimer();
  el.classList.remove('is-fading');
  el.hidden = false;
  el.textContent = message;

  if (fadeAfterMs > 0) {
    browseLoadStatusTimer = setTimeout(() => {
      el.classList.add('is-fading');
      browseLoadStatusTimer = setTimeout(() => {
        el.hidden = true;
        el.classList.remove('is-fading');
        el.textContent = '';
        browseLoadStatusTimer = null;
      }, 420);
    }, fadeAfterMs);
  }
}

function hideBrowseLoadStatus() {
  clearBrowseLoadStatusTimer();
  const el = getLoadStatusEl();
  if (!el) return;
  el.hidden = true;
  el.classList.remove('is-fading');
  el.textContent = '';
}

function bindQuickDateButtons() {
  document.querySelectorAll('[data-game-finder-offset]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const offset = Number(btn.getAttribute('data-game-finder-offset') || 0);
      const d = new Date();
      d.setDate(d.getDate() + offset);
      setActiveQuickChip(offset);
      setGameFinderCalendarDate(d);
      closeCalendarPopover();
      handleFindGames();
    });
  });
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const dt = parseIsoDate(dateStr);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderGameCard(game, onClick) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'mlb-game-card ump-panel--subtle pointer-events-auto';
  const live = game.isLive ?? (!game.isFinal && game.abstractState !== 'Final');
  card.title = `${game.awayTeam} ${game.awayScore ?? 0} – ${game.homeScore ?? 0} ${game.homeTeam}${live ? ' (Live)' : ''}`;
  const awayLogo = getTeamLogoUrl(game.awayTeam);
  const homeLogo = getTeamLogoUrl(game.homeTeam);
  const liveHtml = live ? liveDotMarkup() : '';
  card.innerHTML = `
    ${liveHtml}
    <div class="mlb-game-card__matchup">
      <img class="mlb-game-card__logo" src="${awayLogo}" alt="" width="28" height="28" loading="lazy" decoding="async" />
      <div class="mlb-game-card__score" aria-label="Score">
        <span class="mlb-game-card__runs">${game.awayScore ?? 0}</span>
        <span class="mlb-game-card__sep" aria-hidden="true">–</span>
        <span class="mlb-game-card__runs">${game.homeScore ?? 0}</span>
      </div>
      <img class="mlb-game-card__logo" src="${homeLogo}" alt="" width="28" height="28" loading="lazy" decoding="async" />
    </div>
    <span class="mlb-game-card__date ump-label">${formatDisplayDate(game.date)}</span>
  `;
  card.querySelectorAll('.mlb-game-card__logo').forEach((img) => {
    img.addEventListener('error', () => {
      img.src = '/generic.svg';
    });
  });
  card.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(game);
  });
  return card;
}

function renderEmptyGridMessage(container, message, { pulse = false } = {}) {
  if (!container) return;
  const el = document.createElement('div');
  el.className = `mlb-games-grid__status${pulse ? ' mlb-games-grid__status--pulse' : ''}`;
  el.textContent = message;
  container.replaceChildren(el);
}

function renderGamesIntoGrid(container, games, onSelect, dateStr, maxCards = 48) {
  if (!container) return;
  if (!games.length) {
    renderEmptyGridMessage(container, emptyGamesMessage(dateStr));
    return;
  }
  const slice = games.slice(0, maxCards);
  const frag = document.createDocumentFragment();
  slice.forEach((g) => frag.appendChild(renderGameCard(g, onSelect)));
  container.replaceChildren(frag);
}

function setBrowseGridLoading(container, loading) {
  if (!container) return;
  container.classList.toggle('mlb-games-grid--loading', loading);
  container.setAttribute('aria-busy', loading ? 'true' : 'false');
}

function getCachedDateGames(dateStr) {
  const entry = dateGamesCache.get(dateStr);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > DATE_GAMES_TTL_MS) {
    dateGamesCache.delete(dateStr);
    return null;
  }
  return entry.games;
}

function cacheDateGames(dateStr, games) {
  dateGamesCache.set(dateStr, { games, fetchedAt: Date.now() });
}

export function saveMlbBrowseDate(iso) {
  if (!iso) return;
  browseDateIso = iso;
}

export function clearMlbBrowseDate() {
  setBrowseToDefault();
}

export function rememberMlbPlayContext(gameSummary) {
  if (!gameSummary) return;
  sessionStorage.setItem(
    MLB_PLAY_RETURN_KEY,
    JSON.stringify({
      gameSummary,
      browseDate: getGameFinderCalendarDate(),
    })
  );
}

export function getMlbPlayReturnContext() {
  try {
    const raw = sessionStorage.getItem(MLB_PLAY_RETURN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function restoreMlbBrowseGrid() {
  if (browseDateIso) {
    const d = parseIsoDate(browseDateIso);
    setGameFinderCalendarDate(d);
    syncQuickChipHighlight();
    await handleFindGames();
    return;
  }
  setBrowseToDefault();
  await handleFindGames();
}

export async function returnToMlbGamePicker() {
  const ctx = getMlbPlayReturnContext();
  if (ctx?.browseDate) {
    saveMlbBrowseDate(ctx.browseDate);
  }
  await restoreMlbBrowseGrid();
  if (ctx?.gameSummary) {
    await openGamePreviewForSummary(ctx.gameSummary);
  }
}

export async function loadPlayTabRecentGames(force = false) {
  const grid = deps?.recentGamesGrid;
  if (!grid) return;

  if (!browseDateIso) {
    setBrowseToDefault();
  } else {
    setGameFinderCalendarDate(parseIsoDate(browseDateIso));
    syncQuickChipHighlight();
  }

  await handleFindGames();
}

export async function handleFindGames() {
  const grid = deps?.recentGamesGrid;
  const dateLabel = deps?.recentGamesDate;
  const dateStr = getGameFinderSelectedDate();
  if (!grid) return;

  saveMlbBrowseDate(dateStr);
  syncQuickChipHighlight();
  if (dateLabel) dateLabel.textContent = formatDisplayDate(dateStr);

  const cached = getCachedDateGames(dateStr);
  const requestId = ++browseLoadRequestId;
  const hadCards = grid.querySelector('.mlb-game-card');

  if (cached) {
    renderGamesIntoGrid(grid, cached, onRecentGameSelected, dateStr);
    setBrowseGridLoading(grid, false);
    showBrowseLoadStatus('Games loaded!', { fadeAfterMs: 1200 });
  } else {
    showBrowseLoadStatus('Loading…');
    if (!hadCards) {
      renderEmptyGridMessage(grid, 'Loading games…', { pulse: true });
    } else {
      setBrowseGridLoading(grid, true);
    }
  }

  if (cached) {
    return;
  }

  try {
    const games = await fetchAllGamesForDate(dateStr);
    if (requestId !== browseLoadRequestId) return;
    cacheDateGames(dateStr, games);
    renderGamesIntoGrid(grid, games, onRecentGameSelected, dateStr);
    showBrowseLoadStatus('Games loaded!', { fadeAfterMs: 1400 });
  } catch (err) {
    if (requestId !== browseLoadRequestId) return;
    console.warn('Game finder failed:', err);
    renderEmptyGridMessage(grid, 'Could not load games');
    hideBrowseLoadStatus();
  } finally {
    if (requestId === browseLoadRequestId) {
      setBrowseGridLoading(grid, false);
    }
  }
}

function onRecentGameSelected(game) {
  if (!deps?.requireLoggedInUser?.()) return;
  openGamePreviewForSummary(game);
}

function showBuildOverlay(message, progressPct = null) {
  const overlay = getEl('game-build-overlay');
  const status = getEl('game-build-status');
  const bar = getEl('game-build-progress-bar');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  if (status) status.textContent = message;
  if (bar) {
    bar.style.width = progressPct != null ? `${Math.min(100, progressPct)}%` : '30%';
  }
}

function hideBuildOverlay() {
  const overlay = getEl('game-build-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
}

async function loadGameAtBats(gameSummary, onProgress) {
  const pk = gameSummary.gamePk;
  onProgress?.('Checking cache…', 15);

  const cached = await getCachedGame(pk);
  const cacheFresh = cached?.data && cached.timestamp > Date.now() - GAME_CACHE_MAX_AGE_MS;
  const cacheOk = cacheFresh && cached.meta?.parseVersion === MLB_GAME_FEED_PARSE_VERSION;
  if (cacheOk) {
    onProgress?.('Loaded from cache', 90);
    return cached.data;
  }

  onProgress?.('Fetching play-by-play from MLB…', 35);
  const raw = await fetchGamePitches(pk);
  if (!raw?.length) {
    throw new Error(
      gameSummary.isFinal
        ? 'No pitch data available for this game.'
        : 'Game still in progress — try again after it ends.'
    );
  }

  onProgress?.('Saving to cache…', 75);
  await saveCachedGame(pk, raw, {
    awayTeam: gameSummary.awayTeam,
    homeTeam: gameSummary.homeTeam,
    date: gameSummary.date,
    parseVersion: MLB_GAME_FEED_PARSE_VERSION,
  });
  return raw;
}

function showPreviewModal() {
  const overlay = deps?.previewModalOverlay;
  if (!overlay) return;
  overlay.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
  overlay.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
}

export async function openGamePreviewForSummary(gameSummary) {
  if (!deps?.requireLoggedInUser?.()) return;

  if (gameSummary?.date) {
    saveMlbBrowseDate(gameSummary.date);
  }

  clearPreviewState();
  showPreviewModal();

  const modesEl = document.querySelector('.game-preview-panel__modes');
  const quickTab = document.querySelector('#preview-mode-tabs [data-preview-mode="quick"]');
  if (modesEl) modesEl.dataset.activeMode = 'quick';
  if (quickTab) {
    quickTab.classList.add('game-preview-mode-tab--active');
    quickTab.setAttribute('aria-selected', 'true');
    document
      .querySelectorAll('#preview-mode-tabs [data-preview-mode]:not([data-preview-mode="quick"])')
      .forEach((btn) => {
        btn.classList.remove('game-preview-mode-tab--active');
        btn.setAttribute('aria-selected', 'false');
      });
  }

  if (deps.previewModalDate) deps.previewModalDate.textContent = formatDisplayDate(gameSummary.date);
  setPreviewGameHeader(deps, gameSummary);
  collapsePreviewGameDetails(deps);
  if (deps.previewAwayScore) deps.previewAwayScore.textContent = String(gameSummary.awayScore ?? 0);
  if (deps.previewHomeScore) deps.previewHomeScore.textContent = String(gameSummary.homeScore ?? 0);
  if (deps.previewModalAbs) deps.previewModalAbs.textContent = 'Loading…';
  if (deps.previewModalMeta) deps.previewModalMeta.textContent = 'Loading game data…';
  if (deps.previewLoadingIndicator) deps.previewLoadingIndicator.classList.remove('hidden');
  if (deps.btnPreviewModalStart) deps.btnPreviewModalStart.disabled = true;
  if (deps.btnPreviewPlayAb) deps.btnPreviewPlayAb.disabled = true;
  if (deps.btnPreviewPlayInning) deps.btnPreviewPlayInning.disabled = true;
  if (deps.detailModalInningsRow) deps.detailModalInningsRow.innerHTML = '';
  if (deps.detailModalInningHalvesRow) {
    deps.detailModalInningHalvesRow.innerHTML = '';
    deps.detailModalInningHalvesRow.classList.add('hidden');
  }
  if (deps.detailModalAbGrid) {
    deps.detailModalAbGrid.innerHTML = '<p class="game-preview-ab-empty">Loading at-bats…</p>';
  }
  if (deps.previewAbSearch) deps.previewAbSearch.value = '';

  try {
    showBuildOverlay('Building game…', 10);
    const rawAtBats = await loadGameAtBats(gameSummary, (msg, pct) => showBuildOverlay(msg, pct));
    hideBuildOverlay();

    if (deps.previewLoadingIndicator) deps.previewLoadingIndicator.classList.add('hidden');
    populatePreviewModal(deps, gameSummary, rawAtBats);
    window._onPreviewStartCallback = null;
  } catch (err) {
    hideBuildOverlay();
    if (deps.previewLoadingIndicator) deps.previewLoadingIndicator.classList.add('hidden');
    if (deps.previewModalAbs) deps.previewModalAbs.textContent = err.message || 'Failed to load';
    if (deps.previewModalMeta) deps.previewModalMeta.textContent = 'Could not load game';
    if (deps.detailModalAbGrid) {
      deps.detailModalAbGrid.innerHTML = `<p class="game-preview-ab-empty">${err.message || 'Failed'}</p>`;
    }
    console.warn('Game preview load failed:', err);
  }
}
