/**
 * Game preview drill-down: inning tabs, AB search, condensed vs custom play modes.
 */

import {
  atBatsToPlaylist,
  pickCondensedAtBats,
  formatAbOutcomeShort,
  formatGameStatusLine,
  formatGameDateTime,
} from './mlb-api.js';
import { getTeamLogoUrl } from './team-logos.js';

const CONDENSED_MAX = 15;

let previewState = null;
let previewRenderFrame = 0;
let previewSearchDebounce = null;

export function clearPreviewState() {
  previewState = null;
}

export function formatInningParts(inning, isTop) {
  const half = isTop ? 'TOP' : 'BOT';
  const num = String(inning ?? 1);
  return {
    half,
    num,
    inningLabel: `${half} ${num}`,
    searchText: `${half} ${num} top bot ${inning}`.toLowerCase(),
  };
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Display-friendly short team name (e.g. "Blue Jays"). */
export function shortTeamName(fullName) {
  const name = String(fullName || '').trim();
  if (!name) return '—';
  const parts = name.split(/\s+/);
  if (parts.length <= 2) return name;
  return parts.slice(-2).join(' ');
}

function shortVenueName(venue) {
  const v = String(venue || '').trim();
  if (!v || v === 'Unknown Venue') return 'MLB';
  return v
    .replace(/^Oriole Park at /i, '')
    .replace(/^Yankee Stadium$/i, 'Yankee Stad.')
    .replace(/^Rogers Centre$/i, 'Rogers Ctr')
    .slice(0, 28);
}

let gameHeadToggleBound = false;

export function collapsePreviewGameDetails(deps) {
  const panel = deps?.previewGameDetails || document.getElementById('preview-game-details');
  const toggle = deps?.previewGameHeadToggle || document.getElementById('preview-game-header-toggle');
  if (panel) {
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = '';
  }
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function renderPreviewGameDetails(deps, gameSummary, stats = {}) {
  const panel = deps.previewGameDetails;
  if (!panel) return;

  const when = formatGameDateTime(gameSummary.gameDateTime) || formatDisplayDate(gameSummary.date);
  const status = formatGameStatusLine(gameSummary, formatDisplayDate);
  const live = Boolean(gameSummary.isLive);
  const abLine =
    stats.abCount != null
      ? `${stats.abCount} at-bats · ${stats.pitchCount} pitches`
      : 'Play-by-play loading…';

  panel.innerHTML = `
    <dl class="game-preview-game-details__list">
      <div class="game-preview-game-details__row">
        <dt>Matchup</dt>
        <dd>${gameSummary.awayTeam} @ ${gameSummary.homeTeam}</dd>
      </div>
      <div class="game-preview-game-details__row">
        <dt>Score</dt>
        <dd>${gameSummary.awayScore ?? 0} – ${gameSummary.homeScore ?? 0}</dd>
      </div>
      <div class="game-preview-game-details__row">
        <dt>When</dt>
        <dd>${when || '—'}</dd>
      </div>
      <div class="game-preview-game-details__row">
        <dt>Status</dt>
        <dd>${status}${live ? ' <span class="mlb-live-dot mlb-live-dot--inline" aria-hidden="true"></span>' : ''}</dd>
      </div>
      <div class="game-preview-game-details__row">
        <dt>Venue</dt>
        <dd>${gameSummary.venue || 'MLB'}</dd>
      </div>
      <div class="game-preview-game-details__row">
        <dt>Game</dt>
        <dd>${abLine}</dd>
      </div>
    </dl>
    <a class="game-preview-game-details__link" href="https://www.mlb.com/gameday/${gameSummary.gamePk}" target="_blank" rel="noopener noreferrer">View on MLB Gameday</a>
  `;
}

function bindPreviewGameHeadToggle(deps) {
  if (gameHeadToggleBound || !deps.previewGameHeadToggle) return;
  gameHeadToggleBound = true;

  deps.previewGameHeadToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = deps.previewGameDetails;
    const toggle = deps.previewGameHeadToggle;
    if (!panel || !toggle) return;

    const open = panel.classList.contains('hidden');
    if (open) {
      panel.classList.remove('hidden');
      panel.setAttribute('aria-hidden', 'false');
      toggle.setAttribute('aria-expanded', 'true');
      if (previewState?.gameSummary) {
        const pitchCount = previewState.rawAtBats?.reduce((n, ab) => n + ab.length, 0);
        renderPreviewGameDetails(deps, previewState.gameSummary, {
          abCount: previewState.catalog?.length,
          pitchCount,
        });
      }
    } else {
      collapsePreviewGameDetails(deps);
    }
  });
}

function abOutcomeFromPitches(pitches) {
  const last = pitches[pitches.length - 1] || {};
  const short =
    last.ab_outcome_short ||
    formatAbOutcomeShort(last.ab_event, last.ab_event_type) ||
    '';
  const long =
    last.ab_description ||
    last.ab_event ||
    short ||
    'At-bat';
  return { short: short || '—', long };
}

function outcomeTone(short) {
  if (!short || short === '—') return '';
  if (['1B', '2B', '3B', 'HR', 'Hit'].includes(short)) return 'game-preview-ab-outcome--hit';
  if (short === 'K' || short === 'Out' || ['GO', 'FO', 'LO', 'PO'].includes(short)) return 'game-preview-ab-outcome--out';
  if (['BB', 'HBP'].includes(short)) return 'game-preview-ab-outcome--reach';
  return '';
}

export function buildAbCatalog(rawAtBats) {
  return (rawAtBats || []).map((pitches, index) => {
    const p0 = pitches[0] || {};
    const last = pitches[pitches.length - 1] || {};
    const inning = p0.inning ?? 1;
    const isTop = Boolean(p0.is_top);
    const parts = formatInningParts(inning, isTop);
    const outcome = abOutcomeFromPitches(pitches);
    const detailText =
      last.ab_description ||
      (last.ab_event ? `${p0.batter || 'Batter'} ${last.ab_event.toLowerCase()}` : outcome.long);
    return {
      index,
      inning,
      isTop,
      inningKey: `${inning}-${isTop ? 'T' : 'B'}`,
      half: parts.half,
      inningNum: parts.num,
      inningLabel: parts.inningLabel,
      searchText: `${parts.searchText} ${outcome.short} ${detailText}`.toLowerCase(),
      batter: p0.batter || 'Batter',
      pitcher: p0.pitcher || 'Pitcher',
      pitchCount: pitches.length,
      outcomeShort: outcome.short,
      outcomeLong: outcome.long,
      detailText,
      outcomeTone: outcomeTone(outcome.short),
      scoreAway: last.score_away,
      scoreHome: last.score_home,
      outs: last.outs,
    };
  });
}

function updatePreviewGameHeader(deps, gameSummary, stats = {}) {
  const live = Boolean(gameSummary.isLive);
  if (deps.previewLiveDot) {
    deps.previewLiveDot.classList.toggle('hidden', !live);
  }
  if (deps.previewModalTitle) {
    deps.previewModalTitle.textContent = `${shortTeamName(gameSummary.awayTeam)} @ ${shortTeamName(gameSummary.homeTeam)}`;
    deps.previewModalTitle.title = `${gameSummary.awayTeam} @ ${gameSummary.homeTeam}`;
  }
  if (deps.previewStatusLine) {
    deps.previewStatusLine.textContent = formatGameStatusLine(gameSummary, formatDisplayDate);
  }
  if (deps.previewModalMeta) {
    const venue = shortVenueName(gameSummary.venue);
    if (stats.abCount != null) {
      deps.previewModalMeta.textContent = `${venue} · ${stats.abCount} AB`;
      deps.previewModalMeta.title = `${gameSummary.venue || 'MLB'} · ${stats.abCount} at-bats · ${stats.pitchCount} pitches`;
    } else {
      deps.previewModalMeta.textContent = `${venue} · loading…`;
      deps.previewModalMeta.title = gameSummary.venue || '';
    }
  }
  bindPreviewGameHeadToggle(deps);
  if (deps.previewGameDetails && !deps.previewGameDetails.classList.contains('hidden')) {
    renderPreviewGameDetails(deps, gameSummary, stats);
  }
}

function abCardExpandHtml(row) {
  const halfLetter = row.half === 'TOP' ? 'T' : 'B';
  const outs =
    row.outs != null ? `${row.outs} out${row.outs === 1 ? '' : 's'}` : '';
  const names = `${row.batter} vs ${row.pitcher}`;
  return `
    <div class="game-preview-ab-card__expand" id="preview-ab-expand-${row.index}">
      <p class="game-preview-ab-card__names-line">${names}</p>
      <p class="game-preview-ab-card__result">${row.detailText || row.outcomeLong}</p>
      <p class="game-preview-ab-card__meta">${row.pitchCount} pitches · ${row.scoreAway ?? 0}–${row.scoreHome ?? 0}${outs ? ` · ${outs}` : ''} · ${halfLetter}${row.inningNum}</p>
    </div>
  `;
}

function getInningNumbers(catalog) {
  return [...new Set(catalog.map((c) => c.inning))].sort((a, b) => a - b);
}

function getHalvesForInning(catalog, inningNum) {
  const halves = new Set(
    catalog.filter((c) => c.inning === inningNum).map((c) => (c.isTop ? 'T' : 'B')),
  );
  return ['T', 'B'].filter((h) => halves.has(h));
}

function inningKeyFrom(inningNum, half) {
  return `${inningNum}-${half}`;
}

function resolveActiveInningKey(catalog, activeInningNum, activeHalf) {
  if (activeInningNum == null) return null;
  const halves = getHalvesForInning(catalog, activeInningNum);
  const half = halves.includes(activeHalf) ? activeHalf : halves[0];
  return half ? inningKeyFrom(activeInningNum, half) : null;
}

function filterCatalog(catalog, inningKey, search) {
  const q = (search || '').trim().toLowerCase();
  return catalog.filter((row) => {
    if (inningKey && row.inningKey !== inningKey) return false;
    if (!q) return true;
    return (
      row.batter.toLowerCase().includes(q) ||
      row.pitcher.toLowerCase().includes(q) ||
      row.inningLabel.toLowerCase().includes(q) ||
      (row.searchText && row.searchText.includes(q))
    );
  });
}

function launchFromSelection(deps, gameSummary, rawAtBats, indices) {
  const picked = indices.map((i) => rawAtBats[i]).filter(Boolean);
  if (!picked.length) return;
  const playlist = atBatsToPlaylist(picked, gameSummary);
  deps.hidePreviewModal?.();
  deps.launchGame(playlist, {
    gamePk: gameSummary.gamePk,
    dateString: gameSummary.date,
    awayTeam: gameSummary.awayTeam,
    homeTeam: gameSummary.homeTeam,
    title: `${gameSummary.awayTeam} @ ${gameSummary.homeTeam}`,
    filmRoomUrl: `https://www.mlb.com/video/game/${gameSummary.gamePk}`,
    umpScorecardUrl: `https://umpscorecards.com/single_game/?game_id=${gameSummary.gamePk}`,
  }, { replaceSession: true });
}

export function initPreviewHub(deps) {
  bindPreviewGameHeadToggle(deps);
  const searchEl = deps.previewAbSearch;
  const playAbBtn = deps.btnPreviewPlayAb;
  const playInningBtn = deps.btnPreviewPlayInning;

  searchEl?.addEventListener('input', () => {
    if (!previewState) return;
    previewState.search = searchEl.value;
    if (previewSearchDebounce) clearTimeout(previewSearchDebounce);
    previewSearchDebounce = setTimeout(() => {
      previewSearchDebounce = null;
      schedulePreviewBrowserRender(deps);
    }, 120);
  });

  playAbBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!previewState || previewState.selectedAbIndex == null) return;
    launchFromSelection(deps, previewState.gameSummary, previewState.rawAtBats, [
      previewState.selectedAbIndex,
    ]);
  });

  playInningBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!previewState) return;
    const inningKey = resolveActiveInningKey(
      previewState.catalog,
      previewState.activeInningNum,
      previewState.activeHalf,
    );
    if (!inningKey) return;
    const indices = previewState.catalog
      .filter((c) => c.inningKey === inningKey)
      .map((c) => c.index);
    launchFromSelection(deps, previewState.gameSummary, previewState.rawAtBats, indices);
  });
}

export function populatePreviewModal(deps, gameSummary, rawAtBats) {
  const catalog = buildAbCatalog(rawAtBats);
  const inningNumbers = getInningNumbers(catalog);
  const firstInning = inningNumbers[0] ?? null;
  const firstHalf = firstInning != null ? getHalvesForInning(catalog, firstInning)[0] || 'T' : 'T';

  previewState = {
    gameSummary,
    rawAtBats,
    catalog,
    inningNumbers,
    activeInningNum: firstInning,
    activeHalf: firstHalf,
    selectedAbIndex: null,
    search: '',
  };

  if (deps.previewAwayLogo) {
    deps.previewAwayLogo.src = getTeamLogoUrl(gameSummary.awayTeam);
    deps.previewAwayLogo.onerror = () => {
      deps.previewAwayLogo.src = '/generic.svg';
    };
  }
  if (deps.previewHomeLogo) {
    deps.previewHomeLogo.src = getTeamLogoUrl(gameSummary.homeTeam);
    deps.previewHomeLogo.onerror = () => {
      deps.previewHomeLogo.src = '/generic.svg';
    };
  }

  const pitchCount = rawAtBats.reduce((n, ab) => n + ab.length, 0);
  updatePreviewGameHeader(deps, gameSummary, { abCount: catalog.length, pitchCount });

  const condensed = pickCondensedAtBats(rawAtBats, CONDENSED_MAX);
  if (deps.previewModalAbs) {
    deps.previewModalAbs.textContent = `${condensed.length} AB condensed · ${catalog.length} AB full game`;
  }

  if (deps.btnPreviewModalStart) {
    deps.btnPreviewModalStart.disabled = false;
    deps.btnPreviewModalStart.onclick = (e) => {
      e.stopPropagation();
      const playlist = atBatsToPlaylist(condensed, gameSummary);
      deps.hidePreviewModal?.();
      deps.launchGame(playlist, {
        gamePk: gameSummary.gamePk,
        dateString: gameSummary.date,
        awayTeam: gameSummary.awayTeam,
        homeTeam: gameSummary.homeTeam,
        title: `${gameSummary.awayTeam} @ ${gameSummary.homeTeam}`,
        filmRoomUrl: `https://www.mlb.com/video/game/${gameSummary.gamePk}`,
        umpScorecardUrl: `https://umpscorecards.com/single_game/?game_id=${gameSummary.gamePk}`,
      }, { replaceSession: true });
    };
  }

  schedulePreviewBrowserRender(deps);
}

export function setPreviewGameHeader(deps, gameSummary) {
  updatePreviewGameHeader(deps, gameSummary);
}

export function schedulePreviewBrowserRender(deps) {
  if (!previewState) return;
  if (previewRenderFrame) cancelAnimationFrame(previewRenderFrame);
  previewRenderFrame = requestAnimationFrame(() => {
    previewRenderFrame = 0;
    renderPreviewBrowser(deps);
  });
}

export function renderPreviewBrowser(deps) {
  if (!previewState) return;
  const { catalog, inningNumbers, activeInningNum, activeHalf, selectedAbIndex, search } =
    previewState;
  const activeInningKey = resolveActiveInningKey(catalog, activeInningNum, activeHalf);
  const inningsRow = deps.detailModalInningsRow;
  const halvesRow = deps.detailModalInningHalvesRow;
  const abGrid = deps.detailModalAbGrid;
  const playAbBtn = deps.btnPreviewPlayAb;
  const playInningBtn = deps.btnPreviewPlayInning;

  if (inningsRow) {
    inningsRow.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `game-preview-inning-tab${activeInningNum == null && !search ? ' game-preview-inning-tab--active' : ''}`;
    allBtn.textContent = 'ALL';
    allBtn.addEventListener('click', () => {
      previewState.activeInningNum = null;
      previewState.selectedAbIndex = null;
      renderPreviewBrowser(deps);
    });
    inningsRow.appendChild(allBtn);

    inningNumbers.forEach((num) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `game-preview-inning-tab${activeInningNum === num ? ' game-preview-inning-tab--active' : ''}`;
      btn.setAttribute('aria-label', `Inning ${num}`);
      btn.innerHTML = `<span class="game-preview-inning-tab__label">${num}</span>`;
      btn.addEventListener('click', () => {
        previewState.activeInningNum = num;
        const halves = getHalvesForInning(catalog, num);
        if (!halves.includes(previewState.activeHalf)) {
          previewState.activeHalf = halves[0] || 'T';
        }
        previewState.selectedAbIndex = null;
        if (deps.previewAbSearch) deps.previewAbSearch.value = '';
        previewState.search = '';
        renderPreviewBrowser(deps);
      });
      inningsRow.appendChild(btn);
    });
  }

  if (halvesRow) {
    halvesRow.innerHTML = '';
    if (activeInningNum != null && !search) {
      const halves = getHalvesForInning(catalog, activeInningNum);
      halvesRow.classList.remove('hidden');
      halves.forEach((half) => {
        const label = half === 'T' ? 'Top' : 'Bot';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `game-preview-inning-half-tab${activeHalf === half ? ' game-preview-inning-half-tab--active' : ''}`;
        btn.textContent = label;
        btn.setAttribute('aria-label', `${label} ${activeInningNum}`);
        btn.addEventListener('click', () => {
          previewState.activeHalf = half;
          previewState.selectedAbIndex = null;
          renderPreviewBrowser(deps);
        });
        halvesRow.appendChild(btn);
      });
    } else {
      halvesRow.classList.add('hidden');
    }
  }

  const filtered = filterCatalog(catalog, search ? null : activeInningKey, search);

  if (abGrid) {
    abGrid.classList.add('game-preview-ab-grid--updating');
    const frag = document.createDocumentFragment();
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'game-preview-ab-empty';
      empty.textContent = 'No at-bats match';
      frag.appendChild(empty);
    } else {
      filtered.forEach((row) => {
        const expanded = selectedAbIndex === row.index;
        const card = document.createElement('div');
        card.className = `game-preview-ab-card${expanded ? ' game-preview-ab-card--expanded' : ''}`;
        card.setAttribute('role', 'listitem');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `game-preview-ab-row${expanded ? ' game-preview-ab-row--active' : ''}`;
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        btn.setAttribute('aria-controls', `preview-ab-expand-${row.index}`);
        const halfLetter = row.half === 'TOP' ? 'T' : 'B';
        const batterShort = row.batter.split(' ').pop() || row.batter;
        const pitcherShort = row.pitcher.split(' ').pop() || row.pitcher;
        btn.innerHTML = `
          <span class="game-preview-ab-row__inning" aria-label="${row.inningLabel}">${halfLetter}${row.inningNum}</span>
          <span class="game-preview-ab-row__matchup">
            <span class="game-preview-ab-row__names">${batterShort} · ${pitcherShort}</span>
          </span>
          <span class="game-preview-ab-outcome game-preview-ab-row__outcome ${row.outcomeTone}">${row.outcomeShort}</span>
          <span class="game-preview-ab-row__pitches">${row.pitchCount}</span>
          <span class="game-preview-ab-row__chevron" aria-hidden="true">${expanded ? '▴' : '▾'}</span>
        `;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          previewState.selectedAbIndex = expanded ? null : row.index;
          renderPreviewBrowser(deps);
        });

        card.appendChild(btn);
        if (expanded) {
          const expand = document.createElement('div');
          expand.innerHTML = abCardExpandHtml(row);
          card.appendChild(expand.firstElementChild);
        }
        frag.appendChild(card);
        if (expanded) {
          requestAnimationFrame(() => {
            card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        }
      });
    }
    abGrid.replaceChildren(frag);
    requestAnimationFrame(() => {
      abGrid.classList.remove('game-preview-ab-grid--updating');
    });
  }

  if (playAbBtn) playAbBtn.disabled = selectedAbIndex == null;
  if (playInningBtn) {
    playInningBtn.disabled = !activeInningKey || search;
    playInningBtn.textContent = activeInningKey
      ? `Play ${catalog.find((c) => c.inningKey === activeInningKey)?.inningLabel || 'half'}`
      : 'Half-inning';
  }
}
