import '../admin.css';

const API = { credentials: 'include' };

function formatApiError(res, data) {
  if (data.error && data.error !== 'Internal Server Error') return data.error;
  if (res.status === 500) {
    const host = typeof location !== 'undefined' ? location.hostname : '';
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (isLocal && (!data.error || data.error === 'Internal Server Error')) {
      return 'API unavailable — run npm run dev:full (or npm run dev:api in another terminal)';
    }
    return (
      data.error ||
      'Server error — set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SESSION_SECRET on Vercel, then redeploy. Check function logs for details.'
    );
  }
  return data.error || res.statusText || 'Request failed';
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...API,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  } catch {
    throw new Error(
      'Cannot reach API — run npm run dev:full (or npm run dev:api in another terminal)'
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(formatApiError(res, data));
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function formatPct(n) {
  if (n === null || n === undefined) return '—';
  if (typeof n === 'string') {
    const trimmed = n.trim();
    if (!trimmed) return '—';
    if (trimmed.includes('%')) return trimmed;
    const parsed = Number(trimmed);
    if (!Number.isNaN(parsed)) return `${Math.round(parsed)}%`;
    return trimmed;
  }
  if (Number.isNaN(Number(n))) return '—';
  return `${Math.round(Number(n))}%`;
}

function accuracySourceLabel(source) {
  const labels = {
    stored: 'saved stats',
    history: 'session history',
    leaderboard: 'leaderboard',
  };
  return labels[source] || '';
}

function formatBoard(board) {
  const labels = { weekly: 'Weekly', daily: 'Daily', alltime: 'All-time' };
  return labels[board] || board;
}

const loginScreen = document.getElementById('admin-login-screen');
const passwordScreen = document.getElementById('admin-password-screen');
const panelScreen = document.getElementById('admin-panel-screen');
const loginForm = document.getElementById('admin-login-form');
const passwordForm = document.getElementById('admin-password-form');
const loginError = document.getElementById('admin-login-error');
const passwordError = document.getElementById('admin-password-error');
const signedInAs = document.getElementById('admin-signed-in-as');
const usersList = document.getElementById('admin-users-list');
const usersSummary = document.getElementById('admin-users-summary');
const userDetail = document.getElementById('admin-user-detail');
const detailBody = document.getElementById('admin-detail-body');
const detailHandle = document.getElementById('admin-detail-handle');
const challengesRoot = document.getElementById('admin-challenges-root');
const streakRoot = document.getElementById('admin-streak-root');

let allUsers = [];
let selectedHandle = null;

function showScreen(screen) {
  [loginScreen, passwordScreen, panelScreen].forEach((el) => {
    if (!el) return;
    el.classList.add('hidden');
  });
  screen?.classList.remove('hidden');
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(el) {
  if (!el) return;
  el.classList.add('hidden');
  el.textContent = '';
}

async function checkSession() {
  try {
    const me = await api('/api/admin/me');
    if (me.mustChangePassword) {
      showScreen(passwordScreen);
    } else {
      showScreen(panelScreen);
      if (signedInAs) signedInAs.textContent = `Signed in as ${me.username}`;
      await loadUsersSafe();
      await loadChallenges();
    }
  } catch {
    showScreen(loginScreen);
  }
}

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(loginError);
  const username = document.getElementById('admin-login-user')?.value;
  const password = document.getElementById('admin-login-pass')?.value;
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (data.mustChangePassword) {
      showScreen(passwordScreen);
    } else {
      showScreen(panelScreen);
      if (signedInAs) signedInAs.textContent = `Signed in as ${data.username}`;
      await loadUsersSafe();
      await loadChallenges();
    }
  } catch (err) {
    showError(loginError, err.message || 'Login failed');
  }
});

passwordForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(passwordError);
  try {
    await api('/api/admin/password', {
      method: 'PUT',
      body: JSON.stringify({
        currentPassword: document.getElementById('admin-pass-current')?.value,
        newPassword: document.getElementById('admin-pass-new')?.value,
      }),
    });
    showScreen(panelScreen);
    await loadUsersSafe();
    await loadChallenges();
  } catch (err) {
    showError(passwordError, err.message || 'Update failed');
  }
});

document.getElementById('admin-btn-logout')?.addEventListener('click', () => {
  document.cookie = 'ump_admin_session=; Path=/; Max-Age=0';
  showScreen(loginScreen);
});

document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.getAttribute('data-admin-tab');
    document.querySelectorAll('[data-admin-tab]').forEach((b) => {
      b.classList.toggle('admin-nav__btn--active', b === btn);
    });
    document.getElementById('admin-tab-users')?.classList.toggle('hidden', tab !== 'users');
    document.getElementById('admin-tab-challenges')?.classList.toggle('hidden', tab !== 'challenges');
    document.getElementById('admin-tab-streak')?.classList.toggle('hidden', tab !== 'streak');
    if (tab === 'streak') loadStreak();
  });
});

function renderUsersSummary(rows) {
  if (!usersSummary) return;
  const totalXp = rows.reduce((sum, u) => sum + (u.stats?.xp ?? 0), 0);
  const withAccuracy = rows.filter((u) => u.stats?.overallAccuracy != null);
  const avgAccuracy = withAccuracy.length
    ? Math.round(
        withAccuracy.reduce((sum, u) => sum + Number(u.stats.overallAccuracy), 0) /
          withAccuracy.length
      )
    : null;

  usersSummary.innerHTML = `
    <div class="admin-kpi">
      <span class="admin-kpi__label">Accounts</span>
      <span class="admin-kpi__value">${rows.length}</span>
    </div>
    <div class="admin-kpi">
      <span class="admin-kpi__label">Total XP</span>
      <span class="admin-kpi__value">${totalXp.toLocaleString()}</span>
    </div>
    <div class="admin-kpi">
      <span class="admin-kpi__label">Avg accuracy</span>
      <span class="admin-kpi__value">${formatPct(avgAccuracy)}</span>
    </div>
  `;
}

function renderUsers(filter = '') {
  if (!usersList) return;
  const q = filter.trim().toUpperCase();
  const rows = allUsers.filter((u) => !q || u.handle.includes(q));
  renderUsersSummary(rows);

  if (!rows.length) {
    usersList.innerHTML = '<p class="ump-subtitle admin-table-empty">No users found</p>';
    return;
  }

  usersList.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th scope="col">Handle</th>
          <th scope="col">Team</th>
          <th scope="col">XP</th>
          <th scope="col">Accuracy</th>
          <th scope="col">Streak</th>
          <th scope="col">Joined</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((u) => {
            const s = u.stats || {};
            return `
          <tr class="admin-table__row" data-handle="${escapeHtml(u.handle)}" tabindex="0" role="button">
            <td><strong>${escapeHtml(u.handle)}</strong></td>
            <td>${escapeHtml(u.favoriteTeam || 'none')}</td>
            <td>${(s.xp ?? 0).toLocaleString()}</td>
            <td>${formatPct(s.overallAccuracy)}</td>
            <td>${s.maxStreak ?? 0}</td>
            <td class="admin-table__muted">${formatDate(u.createdAt)}</td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;

  usersList.querySelectorAll('[data-handle]').forEach((el) => {
    const open = () => openUserDetail(el.getAttribute('data-handle'));
    el.addEventListener('click', open);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });
  });
}

function renderSupabaseSetupHint(el, hint) {
  if (!el) return;
  el.innerHTML = `
    <div class="admin-setup-hint">
      <p><strong>Database not connected</strong></p>
      <p class="ump-subtitle">${escapeHtml(hint || 'Configure Supabase in .env.local and restart the API.')}</p>
      <p class="ump-subtitle">Supabase Dashboard → Project Settings → API → <code>service_role</code> key</p>
    </div>`;
}

function renderUserDetail(data) {
  if (!detailBody) return;
  const profile = data.profile || {};
  const stats = data.stats || {};
  const entries = data.leaderboardEntries || [];
  const historyLen = Array.isArray(stats.history) ? stats.history.length : 0;
  const dailyKeys = stats.dailyHistory && typeof stats.dailyHistory === 'object'
    ? Object.keys(stats.dailyHistory).length
    : 0;

  const accuracyHint = stats.accuracySource
    ? `<span class="admin-table__muted admin-accuracy-source">from ${accuracySourceLabel(stats.accuracySource)}</span>`
    : '';

  const leaderboardRows = entries.length
    ? entries
        .map(
          (e) => `
        <tr>
          <td>${escapeHtml(formatBoard(e.board))}</td>
          <td>${escapeHtml(e.periodKey ?? e.period_key ?? '—')}</td>
          <td>${escapeHtml(e.scoreText ?? e.score_text ?? e.scoreRaw ?? e.score_raw ?? '—')}</td>
          <td>${formatPct(e.accuracy)}</td>
          <td class="admin-table__muted">${formatDate(e.submittedAt ?? e.submitted_at)}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="admin-table__muted">No leaderboard submissions</td></tr>`;

  detailBody.innerHTML = `
    <section class="admin-section">
      <h3 class="admin-section__title">Profile</h3>
      <dl class="admin-dl">
        <div><dt>Handle</dt><dd>${escapeHtml(profile.handle)}</dd></div>
        <div><dt>Favorite team</dt><dd>${escapeHtml(profile.favoriteTeam || 'none')}</dd></div>
        <div><dt>Created</dt><dd>${formatDate(profile.createdAt)}</dd></div>
        <div><dt>Last updated</dt><dd>${formatDate(profile.updatedAt)}</dd></div>
      </dl>
    </section>

    <section class="admin-section">
      <h3 class="admin-section__title">Performance</h3>
      <div class="admin-kpi-row admin-kpi-row--detail">
        <div class="admin-kpi">
          <span class="admin-kpi__label">XP</span>
          <span class="admin-kpi__value">${(stats.xp ?? 0).toLocaleString()}</span>
        </div>
        <div class="admin-kpi">
          <span class="admin-kpi__label">Accuracy</span>
          <span class="admin-kpi__value">${formatPct(stats.overallAccuracy)}${accuracyHint}</span>
        </div>
        <div class="admin-kpi">
          <span class="admin-kpi__label">Max streak</span>
          <span class="admin-kpi__value">${stats.maxStreak ?? 0}</span>
        </div>
        <div class="admin-kpi">
          <span class="admin-kpi__label">Weekly done</span>
          <span class="admin-kpi__value">${stats.completedWeekly ?? 0}</span>
        </div>
        <div class="admin-kpi">
          <span class="admin-kpi__label">DNFs</span>
          <span class="admin-kpi__value">${stats.dnfs ?? 0}</span>
        </div>
        <div class="admin-kpi">
          <span class="admin-kpi__label">Sessions</span>
          <span class="admin-kpi__value">${historyLen}</span>
        </div>
        <div class="admin-kpi">
          <span class="admin-kpi__label">Daily keys</span>
          <span class="admin-kpi__value">${dailyKeys}</span>
        </div>
      </div>
    </section>

    <section class="admin-section">
      <h3 class="admin-section__title">Leaderboard</h3>
      <div class="admin-table-wrap admin-table-wrap--nested">
        <table class="admin-table admin-table--compact">
          <thead>
            <tr>
              <th scope="col">Board</th>
              <th scope="col">Period</th>
              <th scope="col">Score</th>
              <th scope="col">Accuracy</th>
              <th scope="col">Submitted</th>
            </tr>
          </thead>
          <tbody>${leaderboardRows}</tbody>
        </table>
      </div>
    </section>
  `;
}

async function loadUsers() {
  if (usersList) usersList.textContent = 'Loading…';
  if (usersSummary) usersSummary.innerHTML = '';
  try {
    const data = await api('/api/admin/users');
    if (data.supabaseConfigured === false) {
      allUsers = [];
      renderSupabaseSetupHint(usersList, data.setupHint);
      return;
    }
    allUsers = data.users || [];
    renderUsers(document.getElementById('admin-user-search')?.value || '');
  } catch (err) {
    if (usersList) usersList.textContent = err.message || 'Failed to load';
  }
}

async function openUserDetail(handle) {
  selectedHandle = handle;
  if (!userDetail || !detailBody) return;
  userDetail.classList.remove('hidden');
  if (detailHandle) detailHandle.textContent = handle;
  detailBody.innerHTML = '<p class="ump-subtitle">Loading account…</p>';
  try {
    const data = await api(`/api/admin/user?handle=${encodeURIComponent(handle)}`);
    renderUserDetail(data);
  } catch (err) {
    detailBody.innerHTML = `<p class="admin-error">${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById('admin-user-search')?.addEventListener('input', (e) => {
  renderUsers(e.target.value);
});

document.getElementById('admin-refresh-users')?.addEventListener('click', loadUsers);

document.getElementById('admin-detail-close')?.addEventListener('click', () => {
  userDetail?.classList.add('hidden');
  selectedHandle = null;
});

document.getElementById('admin-delete-user')?.addEventListener('click', async () => {
  if (!selectedHandle) return;
  const confirm = window.prompt(`Type ${selectedHandle} to confirm deletion:`);
  if (confirm !== selectedHandle) return;
  try {
    await api(`/api/admin/user?handle=${encodeURIComponent(selectedHandle)}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmHandle: selectedHandle }),
    });
    userDetail?.classList.add('hidden');
    selectedHandle = null;
    await loadUsers();
  } catch (err) {
    alert(err.message || 'Delete failed');
  }
});

function healthBadge(ok, label) {
  const cls = ok ? 'health-ok' : 'health-warn';
  const status = ok ? 'OK' : 'CHECK';
  return `<span class="${cls}" title="${escapeHtml(label)}">${escapeHtml(label)}: ${status}</span>`;
}

let challengePanelData = null;
let selectedWeekId = null;
let selectedBundleId = null;
let reviewBundleDetail = null;
let reviewBundleMeta = { canDelete: false, usedByWeeks: [] };
let challengeViewTab = 'playlist';
let selectedAbIndex = null;
let weekAnalytics = null;
let abDetailCache = null;
let bundleFilterMode = 'all';

function showAdminToast(message, tone = 'ok') {
  let el = document.getElementById('admin-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'admin-toast';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    document.body.appendChild(el);
  }
  if (!message) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = message;
  el.className = `admin-toast admin-toast--${tone === 'err' ? 'err' : tone === 'warn' ? 'warn' : 'ok'}`;
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}

function setChallengeStatus(message, tone = 'ok') {
  showAdminToast(message, tone);
}

function periodLabel(period) {
  if (period === 'current') return 'This week';
  if (period === 'future') return 'Upcoming';
  return 'Past';
}

function periodBadgeClass(period) {
  if (period === 'current') return 'admin-week-badge--current';
  if (period === 'future') return 'admin-week-badge--future';
  return 'admin-week-badge--past';
}

function readConfigFromForm() {
  const form = document.getElementById('admin-gen-form');
  if (!form) return challengePanelData?.config || {};
  const fd = new FormData(form);
  const manualRaw = String(fd.get('manualGamePks') || '').trim();
  const manualGamePks = manualRaw
    ? manualRaw.split(/[\s,]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const perGameCapRaw = String(fd.get('perGameCap') || '').trim();
  const scheduleRaw = String(fd.get('scheduleForWeekId') || '').trim();

  return {
    version: 1,
    label: String(fd.get('label') || 'Admin draft'),
    scheduleForWeekId: scheduleRaw || null,
    games: {
      count: Number(fd.get('gameCount')) || 5,
      lookbackDays: Number(fd.get('lookbackDays')) || 7,
      selectionMode: String(fd.get('selectionMode') || 'high_scoring_diverse'),
      manualGamePks,
      minTotalRuns: Number(fd.get('minTotalRuns')) || 0,
      gameTypes: ['R'],
    },
    playlist: {
      targetAtBats: Number(fd.get('targetAtBats')) || 20,
      borderlineRatio: Number(fd.get('borderlineRatio')) || 0.5,
      borderlineEdgeThresholdFt: Number(fd.get('borderlineEdgeThresholdFt')) || 0.15,
      shuffleSeed: null,
      perGameCap: perGameCapRaw ? Number(perGameCapRaw) : null,
      minPitchesPerAb: 1,
      maxPitchesPerAb: null,
      prioritizeLateInning: fd.get('prioritizeLateInning') === 'on',
    },
    filters: {
      requireCalledPitch: fd.get('requireCalledPitch') === 'on',
      requireCompleteAb: fd.get('requireCompleteAb') === 'on',
      excludeSwingOnlyAbs: fd.get('excludeSwingOnlyAbs') === 'on',
      minCalledPitchesPerAb: 1,
    },
  };
}

function renderGenerationForm(config, weekHint) {
  const c = config || {};
  const games = c.games || {};
  const playlist = c.playlist || {};
  const filters = c.filters || {};
  const manualPks = (games.manualGamePks || []).join(', ');
  const targetWeek = weekHint || selectedWeekId || challengePanelData?.currentIsoWeek || '';

  return `
    <form id="admin-gen-form" class="admin-gen-form-v2">
      <fieldset class="admin-fieldset">
        <legend>Bundle</legend>
        <label class="admin-gen-field admin-gen-field--wide">
          <span class="ump-label">Name</span>
          <input class="ump-input" name="label" type="text" placeholder="e.g. Week 23 — high leverage" value="${escapeHtml(c.label || '')}" />
        </label>
        <label class="admin-gen-field">
          <span class="ump-label">Target ISO week (optional)</span>
          <input class="ump-input" name="scheduleForWeekId" type="text" placeholder="${escapeHtml(targetWeek)}" value="${escapeHtml(c.scheduleForWeekId || targetWeek)}" />
        </label>
      </fieldset>
      <fieldset class="admin-fieldset">
        <legend>Playlist (what players see)</legend>
        <div class="admin-gen-row">
          <label class="admin-gen-field">
            <span class="ump-label">At-bats</span>
            <input class="ump-input" name="targetAtBats" type="number" min="5" max="200" value="${playlist.targetAtBats ?? 20}" />
          </label>
          <label class="admin-gen-field">
            <span class="ump-label">Borderline mix</span>
            <input class="ump-input" name="borderlineRatio" type="number" min="0" max="1" step="0.05" value="${playlist.borderlineRatio ?? 0.5}" title="0 = routine only, 1 = all borderline" />
          </label>
          <label class="admin-gen-field">
            <span class="ump-label">Edge (ft)</span>
            <input class="ump-input" name="borderlineEdgeThresholdFt" type="number" min="0.05" max="0.5" step="0.01" value="${playlist.borderlineEdgeThresholdFt ?? 0.15}" />
          </label>
          <label class="admin-gen-field">
            <span class="ump-label">Max AB / game</span>
            <input class="ump-input" name="perGameCap" type="number" min="1" max="50" placeholder="none" value="${playlist.perGameCap ?? ''}" />
          </label>
        </div>
        <label class="admin-gen-check">
          <input name="prioritizeLateInning" type="checkbox" ${playlist.prioritizeLateInning ? 'checked' : ''} />
          <span>Favor 7th inning and later</span>
        </label>
      </fieldset>
      <fieldset class="admin-fieldset">
        <legend>MLB games (source data)</legend>
        <div class="admin-gen-row">
          <label class="admin-gen-field">
            <span class="ump-label"># of games</span>
            <input class="ump-input" name="gameCount" type="number" min="1" max="10" value="${games.count ?? 5}" />
          </label>
          <label class="admin-gen-field">
            <span class="ump-label">Lookback days</span>
            <input class="ump-input" name="lookbackDays" type="number" min="1" max="30" value="${games.lookbackDays ?? 7}" />
          </label>
          <label class="admin-gen-field">
            <span class="ump-label">Min runs</span>
            <input class="ump-input" name="minTotalRuns" type="number" min="0" max="30" value="${games.minTotalRuns ?? 0}" />
          </label>
        </div>
        <label class="admin-gen-field admin-gen-field--wide">
          <span class="ump-label">Selection</span>
          <select class="ump-input" name="selectionMode">
            <option value="high_scoring_diverse" ${games.selectionMode === 'high_scoring_diverse' ? 'selected' : ''}>High scoring + team diversity</option>
            <option value="latest_final" ${games.selectionMode === 'latest_final' ? 'selected' : ''}>Most recent finals</option>
            <option value="manual_pks" ${games.selectionMode === 'manual_pks' ? 'selected' : ''}>Manual game PKs</option>
          </select>
        </label>
        <label class="admin-gen-field admin-gen-field--wide">
          <span class="ump-label">Manual game PKs</span>
          <input class="ump-input" name="manualGamePks" type="text" placeholder="824839, 824840" value="${escapeHtml(manualPks)}" />
        </label>
      </fieldset>
      <fieldset class="admin-fieldset">
        <legend>Filters</legend>
        <label class="admin-gen-check">
          <input name="requireCalledPitch" type="checkbox" ${filters.requireCalledPitch !== false ? 'checked' : ''} />
          <span>Each AB must include a called ball/strike</span>
        </label>
        <label class="admin-gen-check">
          <input name="requireCompleteAb" type="checkbox" ${filters.requireCompleteAb !== false ? 'checked' : ''} />
          <span>Only full at-bats (walk, K, or ball in play)</span>
        </label>
        <label class="admin-gen-check">
          <input name="excludeSwingOnlyAbs" type="checkbox" ${filters.excludeSwingOnlyAbs ? 'checked' : ''} />
          <span>Exclude swing-only at-bats</span>
        </label>
      </fieldset>
    </form>
  `;
}

async function postChallengeAction(action, extra = {}) {
  const config = readConfigFromForm();
  return api('/api/admin/challenges', {
    method: 'POST',
    body: JSON.stringify({ action, config, ...extra }),
  });
}

function reasonBadgeClass(code) {
  return code === 'borderline' ? 'admin-reason-badge--borderline' : 'admin-reason-badge--standard';
}

function reasonBadgeLabel(code) {
  return code === 'borderline' ? 'Borderline' : 'Standard';
}

function getActiveBundleDetail(data) {
  return (
    reviewBundleDetail ||
    (selectedBundleId === data?.currentSlot?.bundle?.id ? data.currentPlaylist : null)
  );
}

function renderPlaylistAbCards(detail, analytics) {
  const rows = detail?.selectedAtBats || [];
  if (!rows.length) {
    return '<p class="wc-empty">No playlist for this bundle. Build or select another bundle.</p>';
  }
  const analyticsByOrder = new Map((analytics?.perAb || []).map((s) => [s.playOrder, s]));

  return `<div class="wc-ab-grid">${rows
    .map((ab) => {
      const order = ab.playOrder;
      const isSel = selectedAbIndex === order;
      const stats = analyticsByOrder.get(order);
      const acc =
        stats?.accuracy != null ? `${stats.accuracy}%` : '—';
      const reach =
        stats?.reachRate != null ? `${stats.reached} umpires (${stats.reachRate}%)` : 'No player data';
      return `
        <button type="button" class="wc-ab-card${isSel ? ' wc-ab-card--selected' : ''}" data-ab-order="${order}">
          <span class="wc-ab-card__order">${order}</span>
          <span class="wc-ab-card__matchup">${escapeHtml(ab.batter)} <span>vs</span> ${escapeHtml(ab.pitcher)}</span>
          <span class="wc-ab-card__game">${escapeHtml(ab.gameTitle)} · ${ab.pitchCount} pitches</span>
          <span class="wc-ab-card__result">${escapeHtml(ab.abResult || '—')}</span>
          <span class="wc-ab-card__meta">${escapeHtml(ab.endingCount || '')} · <span class="admin-reason-badge ${reasonBadgeClass(ab.reasonCode)}">${escapeHtml(reasonBadgeLabel(ab.reasonCode))}</span></span>
          <span class="wc-ab-card__players">${escapeHtml(reach)} · ${acc} acc.</span>
        </button>`;
    })
    .join('')}</div>`;
}

function renderWeekRail(data) {
  const timeline = data.timeline || [];
  const weeks = timeline.filter((s) => s.period !== 'future').slice(0, 12);
  const upcoming = timeline.filter((s) => s.period === 'future').slice(0, 6);
  const bundles = data.catalog || [];

  const weekItems = weeks
    .map((slot) => {
      const active = slot.weekId === selectedWeekId;
      const bundleLabel = slot.bundle
        ? escapeHtml(slot.bundle.label || slot.bundle.id)
        : 'Unassigned';
      return `
        <button type="button" class="wc-rail-item wc-rail-item--week${active ? ' wc-rail-item--active' : ''}" data-week="${escapeHtml(slot.weekId)}" data-bundle="${escapeHtml(slot.bundle?.id || '')}">
          <span class="admin-week-badge ${periodBadgeClass(slot.period)}">${periodLabel(slot.period)}</span>
          <strong>${escapeHtml(slot.weekId)}</strong>
          <span class="wc-rail-item__sub">${bundleLabel}</span>
          <span class="wc-rail-item__meta">${slot.leaderboardEntries ?? 0} on leaderboard</span>
        </button>`;
    })
    .join('');

  const totalBundlesCount = bundles.length;
  const usedBundlesCount = bundles.filter((b) => b.usedByWeeks?.length > 0).length;
  const unusedBundlesCount = bundles.filter((b) => !b.usedByWeeks?.length).length;

  const filteredBundles = bundles.filter((b) => {
    if (bundleFilterMode === 'used') return b.usedByWeeks?.length > 0;
    if (bundleFilterMode === 'unused') return !b.usedByWeeks?.length;
    return true;
  });

  const library = filteredBundles
    .map((b) => {
      const active = b.id === selectedBundleId;
      const isUsed = b.usedByWeeks?.length > 0;
      const badgeClass = isUsed ? 'admin-week-badge--used' : 'admin-week-badge--unused';
      const badgeLabel = isUsed ? `Used: ${b.usedByWeeks.join(', ')}` : 'Unused';
      return `
        <button type="button" class="wc-rail-item wc-rail-item--bundle${active ? ' wc-rail-item--active' : ''}" data-bundle="${escapeHtml(b.id)}">
          <span class="admin-week-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
          <strong>${escapeHtml(b.label || b.id)}</strong>
          <span class="wc-rail-item__sub"><code>${escapeHtml(b.id)}</code></span>
          <span class="wc-rail-item__meta">${b.targetAtBats ?? 20} AB · ${b.gameCount ?? 0} games</span>
        </button>`;
    })
    .join('');

  const upcomingItems = upcoming
    .map((slot) => {
      const active = slot.weekId === selectedWeekId;
      const bundleLabel = slot.bundle
        ? escapeHtml(slot.bundle.label || slot.bundle.id)
        : 'Unassigned';
      return `
        <button type="button" class="wc-rail-item wc-rail-item--week${active ? ' wc-rail-item--active' : ''}" data-week="${escapeHtml(slot.weekId)}" data-bundle="${escapeHtml(slot.bundle?.id || '')}">
          <span class="admin-week-badge ${periodBadgeClass(slot.period)}">${periodLabel(slot.period)}</span>
          <strong>${escapeHtml(slot.weekId)}</strong>
          <span class="wc-rail-item__sub">${bundleLabel}</span>
        </button>`;
    })
    .join('');

  return `
    <div class="wc-rail-section">
      <p class="wc-rail-heading">Recent &amp; current</p>
      <div class="wc-rail-list">${weekItems || '<p class="wc-empty">No weeks</p>'}</div>
    </div>
    ${
      upcoming.length
        ? `<div class="wc-rail-section">
      <p class="wc-rail-heading">Upcoming</p>
      <div class="wc-rail-list">${upcomingItems}</div>
    </div>`
        : ''
    }
    <div class="wc-rail-section">
      <div class="wc-rail-heading-row">
        <p class="wc-rail-heading">Bundle library</p>
        <button type="button" id="admin-btn-new-bundle" class="ump-btn ump-btn--ghost ump-btn--xs">+ Build</button>
      </div>
      <div class="wc-rail-filter-row">
        <button type="button" class="wc-rail-filter-btn${bundleFilterMode === 'all' ? ' wc-rail-filter-btn--active' : ''}" data-filter-bundles="all">All (${totalBundlesCount})</button>
        <button type="button" class="wc-rail-filter-btn${bundleFilterMode === 'used' ? ' wc-rail-filter-btn--active' : ''}" data-filter-bundles="used">Used (${usedBundlesCount})</button>
        <button type="button" class="wc-rail-filter-btn${bundleFilterMode === 'unused' ? ' wc-rail-filter-btn--active' : ''}" data-filter-bundles="unused">Unused (${unusedBundlesCount})</button>
      </div>
      <div class="wc-rail-list">${library || '<p class="wc-empty">No matching bundles</p>'}</div>
    </div>`;
}

function renderOverviewWorkspace(data, detail) {
  const slot = data.timeline?.find((t) => t.weekId === selectedWeekId);
  const ps = detail?.playlistStats || {};
  const meta = detail?.meta || {};
  const usedWeeks = reviewBundleMeta.usedByWeeks?.length
    ? reviewBundleMeta.usedByWeeks.join(', ')
    : 'Not assigned';
  const weekOptions = (data.timeline || [])
    .filter((t) => t.period !== 'past')
    .map(
      (t) =>
        `<option value="${escapeHtml(t.weekId)}" ${t.weekId === selectedWeekId ? 'selected' : ''}>${escapeHtml(t.weekId)} (${periodLabel(t.period)})</option>`
    )
    .join('');

  const analyticsKpis = weekAnalytics
    ? `
    <div class="wc-kpi-row">
      <div class="wc-kpi"><span class="wc-kpi__label">Active umpires</span><strong>${weekAnalytics.activePlayers}</strong></div>
      <div class="wc-kpi"><span class="wc-kpi__label">Finished challenge</span><strong>${weekAnalytics.finishedPlayers}</strong></div>
      <div class="wc-kpi"><span class="wc-kpi__label">Leaderboard</span><strong>${weekAnalytics.leaderboardCount}</strong></div>
    </div>
    ${
      (weekAnalytics.leaderboard || []).length
        ? `<div class="wc-leaderboard-preview">
      <p class="wc-inspector__section-title">Top scores this week</p>
      <ol class="wc-leaderboard-preview__list">${(weekAnalytics.leaderboard || [])
        .slice(0, 8)
        .map(
          (e, i) =>
            `<li><span>${i + 1}</span> <strong>${escapeHtml(e.handle || '—')}</strong> <span class="wc-meta">${escapeHtml(e.score_text || (e.accuracy != null ? `${e.accuracy}%` : '—'))}</span></li>`
        )
        .join('')}</ol>
    </div>`
        : '<p class="wc-meta">No leaderboard entries yet for this week.</p>'
    }`
    : '<p class="wc-meta">Player analytics appear when Supabase is connected and users play this week’s bundle.</p>';

  return `
    <div class="wc-panel">
      <header class="wc-panel__head">
        <div>
          <h3 class="wc-panel__title">${escapeHtml(detail?.label || selectedBundleId || 'Select a bundle')}</h3>
          <p class="wc-meta"><code>${escapeHtml(selectedBundleId || '—')}</code> · Assigned: ${escapeHtml(usedWeeks)}</p>
        </div>
        <div class="wc-panel__actions">
          <label class="admin-gen-field admin-gen-field--inline">
            <span class="ump-label">Assign week</span>
            <select id="admin-drilldown-week-select" class="ump-input">${weekOptions}</select>
          </label>
          <button type="button" id="admin-drilldown-assign" class="ump-btn ump-btn--primary ump-btn--sm">Assign</button>
          ${
            reviewBundleMeta.canDelete
              ? '<button type="button" id="admin-drilldown-delete" class="ump-btn admin-btn--danger ump-btn--sm">Delete</button>'
              : ''
          }
        </div>
      </header>
      ${renderStatusCards(data)}
      <div class="wc-kpi-row">
        <div class="wc-kpi"><span class="wc-kpi__label">Playlist</span><strong>${ps.selectedAbs ?? '—'} / ${ps.targetAtBats ?? 20}</strong></div>
        <div class="wc-kpi"><span class="wc-kpi__label">Pool</span><strong>${ps.completeCandidateAbs ?? ps.candidateAbs ?? '—'} complete ABs</strong></div>
        <div class="wc-kpi"><span class="wc-kpi__label">Mix</span><strong>${ps.borderlinePool ?? '—'} BL · ${ps.normalPool ?? '—'} std</strong></div>
        <div class="wc-kpi"><span class="wc-kpi__label">Seed</span><strong>${ps.shuffleSeed ?? meta.shuffleSeed ?? '—'}</strong></div>
      </div>
      ${analyticsKpis}
      <div id="admin-schedule-week-actions" class="admin-week-actions"></div>
      ${
        slot
          ? `<p class="wc-meta">Selected week <strong>${escapeHtml(selectedWeekId)}</strong> · ${periodLabel(slot.period)} · ${slot.leaderboardEntries ?? 0} leaderboard entries</p>`
          : ''
      }
    </div>`;
}

function renderAbInspectorPanel() {
  if (!selectedAbIndex || !selectedBundleId) {
    return `<aside class="wc-inspector wc-inspector--empty"><p class="wc-empty">Select an at-bat from the playlist to inspect pitches and player performance.</p></aside>`;
  }
  if (!abDetailCache) {
    return `<aside class="wc-inspector"><p class="wc-meta">Loading at-bat…</p></aside>`;
  }

  const d = abDetailCache.detail;
  const a = abDetailCache.analytics;
  const pitchRows = (d.pitches || [])
    .map(
      (p) => `
      <tr>
        <td>${p.index}</td>
        <td>${escapeHtml(p.pitchType)}</td>
        <td>${p.speedMph ?? '—'}</td>
        <td>${p.countAfter || '—'}</td>
        <td>${escapeHtml(p.realCall)}</td>
        <td>${p.isBorderline ? '<span class="admin-reason-badge admin-reason-badge--borderline">Edge</span>' : '—'}</td>
        <td class="admin-table__muted">${escapeHtml((p.blurb || '').slice(0, 72))}${(p.blurb || '').length > 72 ? '…' : ''}</td>
      </tr>`
    )
    .join('');

  const playerBlock = a
    ? `<div class="wc-inspector__stats">
        <div><span>Reached</span><strong>${a.reached}</strong></div>
        <div><span>Completed AB</span><strong>${a.completed}</strong></div>
        <div><span>Called pitches</span><strong>${a.called}</strong></div>
        <div><span>Accuracy</span><strong>${a.accuracy != null ? `${a.accuracy}%` : '—'}</strong></div>
      </div>`
    : '<p class="wc-meta">No aggregated player calls for this slot yet.</p>';

  return `
    <aside class="wc-inspector">
      <header class="wc-inspector__head">
        <p class="wc-inspector__kicker">At-bat ${d.playOrder}</p>
        <h4 class="wc-inspector__title">${escapeHtml(d.batter)} vs ${escapeHtml(d.pitcher)}</h4>
        <p class="wc-meta">${escapeHtml(d.gameTitle)} · ${d.pitchCount} pitches · ${escapeHtml(d.endingCount || '')}</p>
        <p class="wc-inspector__result">${escapeHtml(d.abResult || '')}</p>
      </header>
      <section class="wc-inspector__section">
        <h5 class="wc-inspector__section-title">Player analytics</h5>
        ${playerBlock}
      </section>
      <section class="wc-inspector__section">
        <h5 class="wc-inspector__section-title">Pitch sequence</h5>
        <div class="admin-table-wrap admin-table-wrap--nested">
          <table class="admin-table admin-table--compact">
            <thead><tr><th>#</th><th>Type</th><th>Mph</th><th>Cnt</th><th>Call</th><th></th><th>Notes</th></tr></thead>
            <tbody>${pitchRows || '<tr><td colspan="7">No pitches</td></tr>'}</tbody>
          </table>
        </div>
      </section>
      ${
        d.filmRoomUrl
          ? `<a class="ump-link" href="${escapeHtml(d.filmRoomUrl)}" target="_blank" rel="noopener">Open Film Room</a>`
          : ''
      }
    </aside>`;
}

function renderWorkspaceMain(data) {
  const detail = getActiveBundleDetail(data);
  const overviewHidden = challengeViewTab !== 'overview' ? ' hidden' : '';
  const playlistHidden = challengeViewTab !== 'playlist' ? ' hidden' : '';
  const buildHidden = challengeViewTab !== 'build' ? ' hidden' : '';

  return `
    <main class="wc-workspace">
      <nav class="wc-tabs" role="tablist">
        <button type="button" class="wc-tab${challengeViewTab === 'overview' ? ' wc-tab--active' : ''}" data-wc-tab="overview">Overview</button>
        <button type="button" class="wc-tab${challengeViewTab === 'playlist' ? ' wc-tab--active' : ''}" data-wc-tab="playlist">Playlist <span class="wc-tab__count">${detail?.selectedAtBats?.length || 0}</span></button>
        <button type="button" class="wc-tab${challengeViewTab === 'build' ? ' wc-tab--active' : ''}" data-wc-tab="build">Build bundle</button>
      </nav>
      <div id="wc-panel-overview" class="wc-panel${overviewHidden}">${detail ? renderOverviewWorkspace(data, detail) : '<p class="wc-empty">Select a week or bundle from the left to view details.</p>'}</div>
      <div id="wc-panel-playlist" class="wc-panel${playlistHidden}">
        ${
          detail
            ? `<p class="wc-meta">Tap an at-bat to inspect the full pitch list and how players performed on that slot.</p>${renderPlaylistAbCards(detail, weekAnalytics)}`
            : '<p class="wc-empty">Select a week or bundle from the left to view playlist.</p>'
        }
      </div>
      <div id="wc-panel-build" class="wc-panel${buildHidden}">
        <p class="wc-meta">Tune sources and filters, then build (~30s). New bundles appear in the library.</p>
        ${renderGenerationForm(data.config, selectedWeekId)}
        <div class="admin-build-actions">
          <button type="button" id="admin-preview-generate" class="ump-btn ump-btn--ghost">Quick preview (2 games)</button>
          <button type="button" id="admin-generate-bundle" class="ump-btn ump-btn--primary">Build full bundle</button>
          <button type="button" id="admin-save-config" class="ump-btn ump-btn--ghost">Save as defaults</button>
        </div>
        <div id="admin-preview-result" class="admin-preview-box hidden"></div>
      </div>
    </main>`;
}

function renderStatusCards(data) {
  const live = data.live || {};
  const assigned = data.currentSlot?.bundle;
  const ps = data.currentPlaylist?.playlistStats || {};
  const playerPath = data.playersLoadViaApi
    ? 'Players fetch /api/weekly-challenge (no git deploy on Vercel)'
    : data.writable
      ? 'Players use weekly_challenge.js in this build'
      : 'Set Supabase env — otherwise players only see the bundled file';

  const liveCard = live.meta
    ? `<p class="admin-status-card__value">${escapeHtml(live.meta.challengeWeekId || '—')}</p>
       <p class="admin-meta-line">${live.weekAligned ? 'Aligned with calendar week' : 'Out of sync with calendar'}</p>
       <p class="admin-meta-line">${live.meta.gameCount ?? '—'} games · ${live.meta.targetAtBats ?? 20} AB target</p>`
    : '<p class="admin-meta-line">No weekly_challenge.js parsed in this deployment.</p>';

  const assignedCard = assigned
    ? `<p class="admin-status-card__value">${escapeHtml(assigned.label || assigned.id)}</p>
       <p class="admin-meta-line"><code>${escapeHtml(assigned.id)}</code></p>
       <p class="admin-meta-line">${ps.selectedAbs ?? assigned.targetAtBats ?? '—'} playlist ABs · ${assigned.gameCount ?? 0} games</p>`
    : '<p class="admin-meta-line">Nothing assigned to this week in the database yet.</p>';

  const upcoming =
    (data.upcomingSlots || []).length > 0
      ? (data.upcomingSlots || [])
          .map(
            (s) =>
              `<li><strong>${escapeHtml(s.weekId)}</strong> — ${escapeHtml(s.bundle?.label || s.bundle?.id || '—')}</li>`
          )
          .join('')
      : '<li class="admin-table__muted">No upcoming weeks scheduled</li>';

  return `
    <div class="admin-status-grid">
      <article class="admin-status-card admin-status-card--live">
        <p class="admin-status-card__label">Bundled file (deploy)</p>
        ${liveCard}
      </article>
      <article class="admin-status-card admin-status-card--current">
        <p class="admin-status-card__label">Playing this week (DB)</p>
        ${assignedCard}
      </article>
      <article class="admin-status-card admin-status-card--queue">
        <p class="admin-status-card__label">Upcoming queue</p>
        <ul class="admin-status-card__list">${upcoming}</ul>
      </article>
    </div>
    <p class="admin-meta-line admin-player-path">${escapeHtml(playerPath)}</p>`;
}

function getUnassignedBundles(catalog) {
  return (catalog || []).filter((b) => !b.usedByWeeks?.length);
}

function renderBundleAssignOptions(catalog, selectedId) {
  return (catalog || [])
    .map(
      (b) =>
        `<option value="${escapeHtml(b.id)}" ${b.id === selectedId ? 'selected' : ''}>${escapeHtml(b.label || b.id)}</option>`
    )
    .join('');
}

async function loadWeekAnalytics() {
  if (!selectedWeekId || !selectedBundleId) {
    weekAnalytics = null;
    return;
  }
  try {
    const result = await api('/api/admin/challenges', {
      method: 'POST',
      body: JSON.stringify({
        action: 'getWeekAnalytics',
        weekId: selectedWeekId,
        bundleId: selectedBundleId,
      }),
    });
    weekAnalytics = result.analytics;
  } catch {
    weekAnalytics = null;
  }
}

async function openAbInspector(playOrder) {
  selectedAbIndex = Number(playOrder);
  abDetailCache = null;
  refreshChallengesWorkspace();
  if (!selectedBundleId) return;
  try {
    const result = await api('/api/admin/challenges', {
      method: 'POST',
      body: JSON.stringify({
        action: 'getAbDetail',
        bundleId: selectedBundleId,
        playOrder: selectedAbIndex,
        weekId: selectedWeekId,
      }),
    });
    abDetailCache = { detail: result.detail, analytics: result.analytics };
  } catch (err) {
    abDetailCache = { error: err.message };
  }
  refreshChallengesWorkspace();
}

function refreshChallengesWorkspace() {
  if (!challengePanelData) return;
  const rail = document.getElementById('wc-rail');
  const workspace = document.getElementById('wc-workspace');
  const inspector = document.getElementById('wc-inspector-mount');
  if (rail) rail.innerHTML = renderWeekRail(challengePanelData);
  if (workspace) workspace.innerHTML = renderWorkspaceMain(challengePanelData);
  if (inspector) {
    if (abDetailCache?.error) {
      inspector.innerHTML = `<aside class="wc-inspector"><p class="admin-status-err">${escapeHtml(abDetailCache.error)}</p></aside>`;
    } else {
      inspector.innerHTML = renderAbInspectorPanel();
    }
  }
  updateScheduleWeekActions();
}

function renderChallengesPanel(data) {
  if (!selectedWeekId) selectedWeekId = data.currentIsoWeek;
  if (!selectedBundleId && data.currentSlot?.bundle?.id) {
    selectedBundleId = data.currentSlot.bundle.id;
  }

  const storageBanner = data.canPersistBundles
    ? `<span class="health-ok">Storage: ${escapeHtml(data.storageMode || 'ok')}</span>`
    : `<span class="health-warn">Storage not configured</span>`;

  return `
    <div class="wc-studio">
      <header class="wc-studio__header ump-panel--subtle">
        <div>
          <p class="ump-kicker">Weekly challenge studio</p>
          <h2 class="wc-studio__title">Schedule, playlist &amp; player analytics</h2>
          <p class="wc-studio__sub">Calendar week <strong>${escapeHtml(data.currentIsoWeek)}</strong> · build bundles, assign weeks, drill into each at-bat</p>
        </div>
        <div class="wc-studio__header-actions">
          ${storageBanner}
          <button type="button" id="admin-refresh-challenges" class="ump-btn ump-btn--ghost ump-btn--sm">Refresh</button>
        </div>
      </header>
      <div class="wc-studio__body">
        <aside id="wc-rail" class="wc-rail ump-panel--subtle">${renderWeekRail(data)}</aside>
        <div id="wc-workspace">${renderWorkspaceMain(data)}</div>
        <div id="wc-inspector-mount">${renderAbInspectorPanel()}</div>
      </div>
    </div>
  `;
}

let challengesDelegationBound = false;

async function selectWeekOrBundle(weekId, bundleId) {
  if (weekId != null) selectedWeekId = weekId;
  if (bundleId !== undefined) selectedBundleId = bundleId;
  abDetailCache = null;
  selectedAbIndex = null;
  if (selectedBundleId) {
    try {
      await loadBundleReview(selectedBundleId);
    } catch {
      reviewBundleDetail = null;
    }
  }
  await loadWeekAnalytics();
  refreshChallengesWorkspace();
}

async function onChallengesRootClick(e) {
  const target = e.target;
  if (!(target instanceof Element)) return;

  if (target.closest('#admin-refresh-challenges')) {
    showAdminToast('');
    loadChallenges();
    return;
  }
  if (target.closest('#admin-generate-bundle')) {
    onGenerateBundle();
    return;
  }
  if (target.closest('#admin-preview-generate')) {
    onPreviewGenerate();
    return;
  }
  if (target.closest('#admin-save-config')) {
    onSaveConfig();
    return;
  }
  if (target.closest('#admin-drilldown-assign')) {
    onDrilldownAssign();
    return;
  }
  if (target.closest('#admin-drilldown-delete')) {
    onDeleteBundle();
    return;
  }
  if (target.closest('#admin-btn-new-bundle')) {
    selectedWeekId = null;
    selectedBundleId = null;
    reviewBundleDetail = null;
    reviewBundleMeta = { canDelete: false, usedByWeeks: [] };
    weekAnalytics = null;
    challengeViewTab = 'build';
    refreshChallengesWorkspace();
    return;
  }
  const filterBtn = target.closest('[data-filter-bundles]');
  if (filterBtn) {
    bundleFilterMode = filterBtn.getAttribute('data-filter-bundles') || 'all';
    refreshChallengesWorkspace();
    return;
  }

  const tab = target.closest('[data-wc-tab]');
  if (tab) {
    challengeViewTab = tab.getAttribute('data-wc-tab') || 'playlist';
    refreshChallengesWorkspace();
    return;
  }

  const abCard = target.closest('.wc-ab-card[data-ab-order]');
  if (abCard) {
    await openAbInspector(abCard.getAttribute('data-ab-order'));
    return;
  }

  const weekItem = target.closest('.wc-rail-item--week[data-week]');
  if (weekItem) {
    const w = weekItem.getAttribute('data-week');
    const b = weekItem.getAttribute('data-bundle');
    challengeViewTab = 'overview';
    await selectWeekOrBundle(w, b || null);
    return;
  }

  const bundleItem = target.closest('.wc-rail-item--bundle[data-bundle]');
  if (bundleItem) {
    challengeViewTab = 'overview';
    await selectWeekOrBundle(undefined, bundleItem.getAttribute('data-bundle'));
  }
}

function bindChallengesPanelEvents() {
  if (!challengesDelegationBound && challengesRoot) {
    challengesDelegationBound = true;
    challengesRoot.addEventListener('click', onChallengesRootClick);
  }
  updateScheduleWeekActions();
}

function updateScheduleWeekActions() {
  const wrap = document.getElementById('admin-schedule-week-actions');
  if (!wrap || !challengePanelData) return;
  const slot = challengePanelData.timeline.find((t) => t.weekId === selectedWeekId);
  if (!slot) {
    wrap.classList.add('hidden');
    return;
  }
  const isCurrent = slot.period === 'current';
  wrap.classList.remove('hidden');
  wrap.innerHTML = `
    <p class="ump-label">Selected: ${escapeHtml(selectedWeekId)}</p>
    <button type="button" class="ump-btn ump-btn--ghost ump-btn--sm" data-action="pick-for-review">Review assigned bundle</button>
    ${
      isCurrent
        ? `<button type="button" class="ump-btn admin-btn--danger ump-btn--sm" data-action="reset-lb" data-week="${escapeHtml(selectedWeekId)}">Reset leaderboard</button>
           <button type="button" class="ump-btn ump-btn--ghost ump-btn--sm" data-action="deploy-live" data-week="${escapeHtml(selectedWeekId)}">Deploy live file</button>`
        : slot.period !== 'past'
          ? `<button type="button" class="ump-btn ump-btn--ghost ump-btn--sm" data-action="unassign-week" data-week="${escapeHtml(selectedWeekId)}">Clear assignment</button>`
          : ''
    }
  `;
  wrap.querySelector('[data-action="pick-for-review"]')?.addEventListener('click', () => {
    if (slot.bundle?.id) {
      selectWeekOrBundle(selectedWeekId, slot.bundle.id);
    } else {
      setChallengeStatus('No bundle assigned to this week', 'warn');
    }
  });
  wrap.querySelector('[data-action="reset-lb"]')?.addEventListener('click', () =>
    onResetLeaderboard(selectedWeekId)
  );
  wrap.querySelector('[data-action="deploy-live"]')?.addEventListener('click', () =>
    onDeployLive(selectedWeekId)
  );
  wrap.querySelector('[data-action="unassign-week"]')?.addEventListener('click', () =>
    onUnassignWeek(selectedWeekId)
  );
}

async function loadBundleReview(bundleId) {
  if (!bundleId) {
    reviewBundleDetail = null;
    reviewBundleMeta = { canDelete: false, usedByWeeks: [] };
    return;
  }
  const result = await api('/api/admin/challenges', {
    method: 'POST',
    body: JSON.stringify({ action: 'getBundle', bundleId }),
  });
  reviewBundleDetail = result.detail;
  reviewBundleMeta = {
    canDelete: !!result.canDelete,
    usedByWeeks: result.usedByWeeks || [],
  };
}

async function onDrilldownAssign() {
  const weekId = document.getElementById('admin-drilldown-week-select')?.value || selectedWeekId;
  const bundleId = selectedBundleId;
  if (!bundleId || !weekId) {
    setChallengeStatus('Choose a week to assign this bundle', 'err');
    return;
  }
  await onAssignWeek(weekId, bundleId);
}

async function onAssignWeek(weekId, bundleIdArg) {
  const bundleId = bundleIdArg || selectedBundleId;
  if (!bundleId) {
    setChallengeStatus('Pick a bundle first', 'err');
    return;
  }
  const isCurrent = weekId === challengePanelData?.currentIsoWeek;
  const msg = isCurrent
    ? `Assign to CURRENT week ${weekId}? This resets the weekly leaderboard.`
    : `Assign to ${weekId}?`;
  if (!window.confirm(msg)) return;

  const btns = challengesRoot?.querySelectorAll('#admin-drilldown-assign');
  btns?.forEach((b) => {
    b.disabled = true;
  });
  try {
    setChallengeStatus('Assigning…', 'warn');
    const result = await api('/api/admin/challenges', {
      method: 'POST',
      body: JSON.stringify({ action: 'assignWeek', weekId, bundleId, deployLive: true, resetLeaderboard: true }),
    });
    setChallengeStatus(result.message || 'Assigned', 'ok');
    selectedWeekId = weekId;
    selectedBundleId = bundleId;
    await loadChallenges();
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  } finally {
    btns?.forEach((b) => {
      b.disabled = false;
    });
  }
}

async function onDeleteBundle() {
  if (!selectedBundleId) return;
  if (!window.confirm(`Delete bundle ${selectedBundleId}? This cannot be undone.`)) return;
  try {
    await api('/api/admin/challenges', {
      method: 'POST',
      body: JSON.stringify({ action: 'deleteBundle', bundleId: selectedBundleId }),
    });
    selectedBundleId = null;
    reviewBundleDetail = null;
    reviewBundleMeta = { canDelete: false, usedByWeeks: [] };
    setChallengeStatus('Bundle deleted', 'ok');
    await loadChallenges();
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  }
}

async function onDeployLive(weekId) {
  try {
    setChallengeStatus('Deploying live bundle…', 'warn');
    const result = await api('/api/admin/challenges', {
      method: 'POST',
      body: JSON.stringify({ action: 'deployLive', weekId }),
    });
    setChallengeStatus(result.deploy ? 'Live app updated' : 'Done', 'ok');
    await loadChallenges();
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  }
}

async function onResetLeaderboard(weekId) {
  if (!window.confirm(`Delete all weekly leaderboard rows for ${weekId}?`)) return;
  try {
    const result = await api('/api/admin/challenges', {
      method: 'POST',
      body: JSON.stringify({ action: 'resetLeaderboard', weekId }),
    });
    setChallengeStatus(`Removed ${result.leaderboardReset?.deleted ?? 0} entries`, 'ok');
    await loadChallenges();
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  }
}

async function onUnassignWeek(weekId) {
  if (!window.confirm(`Remove assignment for ${weekId}?`)) return;
  try {
    await api('/api/admin/challenges', {
      method: 'POST',
      body: JSON.stringify({ action: 'unassignWeek', weekId }),
    });
    setChallengeStatus('Assignment cleared', 'ok');
    await loadChallenges();
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  }
}

async function onGenerateBundle() {
  const weekInput =
    document.querySelector('[name="scheduleForWeekId"]')?.value ||
    selectedWeekId ||
    challengePanelData?.currentIsoWeek;
  const label = document.querySelector('[name="label"]')?.value || `Bundle ${weekInput}`;
  const btn = document.getElementById('admin-generate-bundle');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Building…';
  }
  try {
    setChallengeStatus('Fetching MLB and building bundle (~30s)…', 'warn');
    const result = await postChallengeAction('generateBundle', {
      weekId: weekInput,
      label,
    });
    selectedBundleId = result.bundleId;
    await loadBundleReview(result.bundleId);
    challengeViewTab = 'playlist';
    setChallengeStatus(`Built “${label}”. Review the playlist, then assign to a week.`, 'ok');
    await loadChallenges();
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Build full bundle';
    }
  }
}

async function onPreviewGenerate() {
  const btn = document.getElementById('admin-preview-generate');
  if (btn) btn.disabled = true;
  try {
    setChallengeStatus('Quick preview…', 'warn');
    const result = await postChallengeAction('previewGenerate', { maxGames: 2 });
    const box = document.getElementById('admin-preview-result');
    if (box) {
      const ps = result.playlistStats || {};
      const games = (result.games || [])
        .map((g) => `<li>${escapeHtml(g.title)} (${g.pitchCount} pitches)</li>`)
        .join('');
      box.innerHTML = `
        <p><strong>Preview only</strong> — not saved. ${escapeHtml(result.note || '')}</p>
        <p>Would create a <strong>${ps.selectedAbs}/${ps.targetAtBats}</strong> AB playlist.</p>
        <ul>${games}</ul>`;
      box.classList.remove('hidden');
    }
    setChallengeStatus('Preview ready — adjust settings or build full bundle', 'ok');
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function onSaveConfig() {
  const btn = document.getElementById('admin-save-config');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }
  try {
    setChallengeStatus('Saving generator defaults…', 'warn');
    const result = await postChallengeAction('saveConfig');
    if (result.ok) {
      setChallengeStatus('Curator configuration defaults saved successfully!', 'ok');
      if (challengePanelData) {
        challengePanelData.config = result.config;
      }
    } else {
      setChallengeStatus(result.error || 'Failed to save configuration defaults.', 'err');
    }
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save as defaults';
    }
  }
}

async function loadChallenges() {
  if (!challengesRoot) return;
  challengesRoot.innerHTML = '<p class="admin-meta-line">Loading…</p>';
  try {
    const data = await api('/api/admin/challenges');
    challengePanelData = data;
    if (!selectedWeekId) selectedWeekId = data.currentIsoWeek;
    if (!selectedBundleId && data.currentSlot?.bundle?.id) {
      selectedBundleId = data.currentSlot.bundle.id;
    }
    if (selectedBundleId) {
      try {
        await loadBundleReview(selectedBundleId);
      } catch {
        reviewBundleDetail = null;
      }
    }
    challengesRoot.innerHTML = renderChallengesPanel(data);
    bindChallengesPanelEvents();
    await loadWeekAnalytics();
    refreshChallengesWorkspace();
  } catch (err) {
    challengesRoot.innerHTML = `<p class="admin-status-err">${escapeHtml(err.message || 'Failed to load')}</p>`;
    setChallengeStatus(err.message, 'err');
    showAdminToast(err.message, 'err');
  }
}

async function loadUsersSafe() {
  try {
    await loadUsers();
  } catch (err) {
    if (usersList) usersList.innerHTML = `<p class="admin-status-err">${escapeHtml(err.message)}</p>`;
    showAdminToast(err.message, 'err');
  }
}

let streakPanelData = null;
let streakDistribution = null;
let streakAbsPage = 1;
let streakSessionsPage = 1;
let streakIngestBusy = false;

const STREAK_TEAMS = [
  '', 'AZ', 'ATL', 'BAL', 'BOS', 'CHC', 'CWS', 'CIN', 'CLE', 'COL', 'DET',
  'HOU', 'KC', 'LAA', 'LAD', 'MIA', 'MIL', 'MIN', 'NYM', 'NYY', 'OAK', 'ATH',
  'PHI', 'PIT', 'SD', 'SF', 'SEA', 'STL', 'TB', 'TEX', 'TOR', 'WSH',
];

/* ---------- Overview: KPIs + phase ---------- */

function renderStreakOverview(data) {
  const phase = data.readiness?.phase || 'unknown';
  const phaseMeta = {
    bundle_only: { label: 'Bundle only', tone: 'warn', hint: 'ABs ship in the JS build — ingest to move to a live DB pool.' },
    partial_ingest: { label: 'Partial pool', tone: 'mid', hint: 'Some ABs ingested. Keep ingesting toward a deep pool.' },
    supabase_pool: { label: 'Live pool', tone: 'ok', hint: 'Supabase pool is the source of truth.' },
  }[phase] || { label: phase, tone: 'mid', hint: '' };

  const pool = data.poolCount ?? 0;
  const eligible = data.eligibleCount ?? 0;
  const eligiblePct = pool > 0 ? Math.round((100 * eligible) / pool) : 0;

  return `
    <header class="admin-streak-hero">
      <div class="admin-streak-hero__titles">
        <p class="ump-kicker">Streak challenge</p>
        <h2 class="ump-title ump-title--sm">At-bat pool &amp; ingest</h2>
        <p class="admin-meta-line admin-streak-hero__hint">${escapeHtml(phaseMeta.hint)}</p>
      </div>
      <div class="admin-streak-hero__actions">
        <span class="admin-streak-phase admin-streak-phase--${phaseMeta.tone}">${escapeHtml(phaseMeta.label)}</span>
        <button type="button" id="admin-refresh-streak" class="ump-btn ump-btn--ghost ump-btn--sm">↻ Refresh</button>
      </div>
    </header>
    <div class="admin-stat-grid">
      <div class="admin-stat-card admin-stat-card--accent">
        <span class="admin-stat-card__label">Eligible ABs</span>
        <span class="admin-stat-card__value">${eligible.toLocaleString()}</span>
        <span class="admin-stat-card__sub">${eligiblePct}% of ${pool.toLocaleString()} in pool</span>
      </div>
      <div class="admin-stat-card">
        <span class="admin-stat-card__label">Avg difficulty</span>
        <span class="admin-stat-card__value">${data.distribution?.avgDifficulty ?? '—'}</span>
        <span class="admin-stat-card__sub">0–100 scale</span>
      </div>
      <div class="admin-stat-card">
        <span class="admin-stat-card__label">Sessions</span>
        <span class="admin-stat-card__value">${(data.sessionCount ?? 0).toLocaleString()}</span>
        <span class="admin-stat-card__sub">logged runs</span>
      </div>
      <div class="admin-stat-card">
        <span class="admin-stat-card__label">ABs with play stats</span>
        <span class="admin-stat-card__value">${(data.statsRowCount ?? 0).toLocaleString()}</span>
        <span class="admin-stat-card__sub">served at least once</span>
      </div>
    </div>`;
}

/* ---------- Difficulty distribution histogram ---------- */

function renderStreakDistribution(dist) {
  if (!dist || !dist.buckets?.length || !dist.eligibleCount) {
    return `<section class="admin-streak-card">
      <h3 class="admin-streak-card__title">Difficulty distribution</h3>
      <p class="admin-meta-line">No eligible ABs yet — ingest a slate below to populate the curve.</p>
    </section>`;
  }
  const max = Math.max(1, ...dist.buckets.map((b) => b.count));
  const bars = dist.buckets
    .map((b) => {
      const pct = Math.round((100 * b.count) / max);
      const heat = b.min >= 70 ? 'hot' : b.min >= 40 ? 'mid' : 'cool';
      return `<div class="admin-histo__col" title="${b.label}: ${b.count} ABs">
        <div class="admin-histo__bar admin-histo__bar--${heat}" style="--h:${pct}%">
          <span class="admin-histo__count">${b.count}</span>
        </div>
        <span class="admin-histo__label">${b.min}</span>
      </div>`;
    })
    .join('');
  const tierChips = (dist.tiers || [])
    .map((c, i) => `<span class="admin-tier-chip admin-tier-chip--${i + 1}">T${i + 1}<b>${c}</b></span>`)
    .join('');
  return `<section class="admin-streak-card">
    <div class="admin-streak-card__head">
      <h3 class="admin-streak-card__title">Difficulty distribution</h3>
      <div class="admin-tier-chips">${tierChips}</div>
    </div>
    <div class="admin-histo" role="img" aria-label="At-bat difficulty distribution">${bars}</div>
    <p class="admin-meta-line">Buckets of 10 across ${dist.eligibleCount.toLocaleString()} eligible ABs. Aim for a full curve so the progressive ramp has material at every level.</p>
  </section>`;
}

/* ---------- Pool controls: Statcast fetch + CSV paste ---------- */

function renderStreakIngestControls() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const teamOpts = STREAK_TEAMS
    .map((t) => `<option value="${t}">${t || 'All teams'}</option>`)
    .join('');
  return `<section class="admin-streak-card admin-streak-ingest">
    <div class="admin-streak-card__head">
      <h3 class="admin-streak-card__title">Grow the pool</h3>
      <div class="admin-seg" role="tablist" aria-label="Ingest source">
        <button type="button" class="admin-seg__btn admin-seg__btn--active" data-ingest-tab="statcast">Statcast fetch</button>
        <button type="button" class="admin-seg__btn" data-ingest-tab="csv">Paste CSV</button>
      </div>
    </div>

    <div class="admin-ingest-pane" data-ingest-pane="statcast">
      <p class="admin-meta-line">Pulls real games from baseball-savant by date range, scores close-call difficulty, and upserts eligible ABs. Fetched per day (max 31).</p>
      <div class="admin-field-row">
        <label class="admin-field"><span class="ump-label">Start date</span>
          <input id="ingest-start" type="date" class="ump-input" value="${weekAgo}" max="${today}" /></label>
        <label class="admin-field"><span class="ump-label">End date</span>
          <input id="ingest-end" type="date" class="ump-input" value="${weekAgo}" max="${today}" /></label>
        <label class="admin-field"><span class="ump-label">Team</span>
          <select id="ingest-team" class="ump-input">${teamOpts}</select></label>
        <label class="admin-field admin-field--narrow"><span class="ump-label">Min difficulty</span>
          <input id="ingest-mindiff" type="number" class="ump-input" min="0" max="100" value="0" /></label>
      </div>
      <div class="admin-ingest-actions">
        <button type="button" id="ingest-run-statcast" class="ump-btn ump-btn--primary ump-btn--sm">Fetch &amp; ingest</button>
        <span class="admin-meta-line">Tip: a single recent day across all teams is a fast first pull.</span>
      </div>
    </div>

    <div class="admin-ingest-pane hidden" data-ingest-pane="csv">
      <p class="admin-meta-line">Paste a baseball-savant “type=details” CSV (header row included). Scored and upserted the same way.</p>
      <label class="admin-field"><span class="ump-label">CSV text</span>
        <textarea id="ingest-csv" class="ump-input admin-textarea" rows="6" placeholder="pitch_type,game_date,release_speed,..."></textarea></label>
      <div class="admin-field-row">
        <label class="admin-field admin-field--narrow"><span class="ump-label">Min difficulty</span>
          <input id="ingest-csv-mindiff" type="number" class="ump-input" min="0" max="100" value="0" /></label>
        <div class="admin-ingest-actions">
          <button type="button" id="ingest-run-csv" class="ump-btn ump-btn--primary ump-btn--sm">Ingest CSV</button>
        </div>
      </div>
    </div>

    <div id="ingest-result" class="admin-ingest-result hidden"></div>
  </section>`;
}

function renderIngestResult(r) {
  const tiers = (r.tierCounts || [])
    .map((c, i) => `<span class="admin-tier-chip admin-tier-chip--${i + 1}">T${i + 1}<b>${c}</b></span>`)
    .join('');
  const rejects = Object.entries(r.rejectReasons || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<li><code>${escapeHtml(k)}</code> <b>${v}</b></li>`)
    .join('');
  const dayLines = (r.days || [])
    .filter((d) => !d.ok || d.rows)
    .map((d) => `<li>${escapeHtml(d.date)} — ${d.ok ? `${d.rows} pitches` : `<span class="admin-status-err">${escapeHtml(d.error || 'failed')}</span>`}</li>`)
    .join('');
  return `
    <div class="admin-ingest-result__head">
      <span class="admin-ingest-result__badge">Ingest complete</span>
      ${r.note ? `<span class="admin-meta-line">${escapeHtml(r.note)}</span>` : ''}
    </div>
    <div class="admin-stat-grid admin-stat-grid--compact">
      <div class="admin-stat-card admin-stat-card--accent"><span class="admin-stat-card__label">Inserted</span><span class="admin-stat-card__value">${(r.inserted ?? 0).toLocaleString()}</span></div>
      <div class="admin-stat-card"><span class="admin-stat-card__label">Eligible</span><span class="admin-stat-card__value">${(r.eligible ?? 0).toLocaleString()}</span></div>
      <div class="admin-stat-card"><span class="admin-stat-card__label">Total ABs</span><span class="admin-stat-card__value">${(r.totalAbs ?? 0).toLocaleString()}</span></div>
      ${r.fetchedRows != null ? `<div class="admin-stat-card"><span class="admin-stat-card__label">Pitches fetched</span><span class="admin-stat-card__value">${r.fetchedRows.toLocaleString()}</span></div>` : ''}
    </div>
    ${tiers ? `<div class="admin-tier-chips admin-tier-chips--spaced">${tiers}</div>` : ''}
    ${dayLines ? `<details class="admin-ingest-details"><summary>Per-day fetch</summary><ul class="admin-ingest-list">${dayLines}</ul></details>` : ''}
    ${rejects ? `<details class="admin-ingest-details"><summary>Rejected at-bats (not close-call eligible)</summary><ul class="admin-ingest-list">${rejects}</ul></details>` : ''}
    ${(r.errors || []).length ? `<p class="admin-status-err">${escapeHtml(r.errors.join('; '))}</p>` : ''}`;
}

/* ---------- AB browser ---------- */

function difficultyBadge(d) {
  if (d == null) return '<span class="admin-diff-badge">—</span>';
  const tone = d >= 70 ? 'hot' : d >= 40 ? 'mid' : 'cool';
  return `<span class="admin-diff-badge admin-diff-badge--${tone}">${d}</span>`;
}

function renderStreakAbsTable(rows, total, page, limit) {
  const toolbar = `
    <div class="admin-toolbar">
      <input id="admin-streak-ab-search" type="search" class="ump-input admin-input--search" placeholder="Search pitcher, batter, id…" />
      <select id="admin-streak-ab-sort" class="ump-input">
        <option value="difficulty">Hardest first</option>
        <option value="times_served">Most played</option>
        <option value="last_used">Last used</option>
        <option value="id">ID</option>
      </select>
      <span class="admin-toolbar__spacer"></span>
      <button type="button" id="admin-streak-abs-prev" class="ump-btn ump-btn--ghost ump-btn--sm" ${page <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="admin-meta-line">Page ${page} / ${Math.max(1, Math.ceil(total / limit))} · ${total.toLocaleString()} total</span>
      <button type="button" id="admin-streak-abs-next" class="ump-btn ump-btn--ghost ump-btn--sm" ${page >= Math.max(1, Math.ceil(total / limit)) ? 'disabled' : ''}>Next</button>
    </div>`;

  if (!rows?.length) {
    return `${toolbar}<p class="admin-empty">No ABs match. Ingest a slate above, or clear the search.</p>`;
  }
  const body = rows
    .map((r) => {
      const s = r.stats || {};
      const acc = s.pitches_seen > 0 ? `${Math.round((100 * (s.correct_calls || 0)) / s.pitches_seen)}%` : '—';
      const m = r.metrics || {};
      return `<tr>
        <td>${difficultyBadge(r.difficulty)}</td>
        <td class="admin-ab-matchup"><b>${escapeHtml(r.pitcher || '—')}</b><span>vs ${escapeHtml(r.batter || '—')}</span></td>
        <td class="admin-table__mono admin-table__truncate" title="${escapeHtml(r.id)}">${escapeHtml(r.id)}</td>
        <td>${m.borderlineCount ?? '—'}</td>
        <td>${s.times_served ?? 0}</td>
        <td>${acc}</td>
        <td>${formatDate(s.last_played_at)}</td>
      </tr>`;
    })
    .join('');
  return `${toolbar}
    <div class="admin-table-wrap">
      <table class="admin-table admin-table--streak">
        <thead><tr>
          <th>Diff</th><th>Matchup</th><th>AB id</th><th>Borderline</th><th>Served</th><th>Accuracy</th><th>Last played</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

/* ---------- Sessions (deduped, richer) ---------- */

function fmtDuration(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function renderStreakSessionsTable(rows, total, page, limit) {
  const toolbar = `
    <div class="admin-toolbar">
      <input id="admin-streak-session-handle" type="search" class="ump-input admin-input--search" placeholder="Filter handle…" />
      <span class="admin-toolbar__spacer"></span>
      <button type="button" id="admin-streak-sessions-prev" class="ump-btn ump-btn--ghost ump-btn--sm" ${page <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="admin-meta-line">Page ${page} / ${Math.max(1, Math.ceil(total / limit))} · ${total.toLocaleString()} total</span>
      <button type="button" id="admin-streak-sessions-next" class="ump-btn ump-btn--ghost ump-btn--sm" ${page >= Math.max(1, Math.ceil(total / limit)) ? 'disabled' : ''}>Next</button>
    </div>`;
  if (!rows?.length) {
    return `${toolbar}<p class="admin-empty">No streak sessions recorded yet. Logged-in players post a run when their streak ends.</p>`;
  }
  const body = rows
    .map((r) => {
      const accTone = r.accuracy == null ? '' : r.accuracy >= 80 ? 'ok' : r.accuracy >= 50 ? 'mid' : 'low';
      return `<tr>
        <td><b>${escapeHtml(r.handle)}</b></td>
        <td><span class="admin-streak-num">${r.correct_streak}</span></td>
        <td>${r.abs_played}</td>
        <td>${r.correct_pitches}/${r.pitches_called}</td>
        <td>${r.accuracy == null ? '—' : `<span class="admin-acc admin-acc--${accTone}">${r.accuracy}%</span>`}</td>
        <td>${fmtDuration(r.duration_sec)}</td>
        <td>${formatDate(r.ended_at)}</td>
      </tr>`;
    })
    .join('');
  return `${toolbar}
    <div class="admin-table-wrap">
      <table class="admin-table admin-table--streak">
        <thead><tr><th>Player</th><th>Streak</th><th>ABs</th><th>Pitches</th><th>Accuracy</th><th>Duration</th><th>Ended</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

/* ---------- Events ---------- */

function bindStreakPanelEvents() {
  if (!streakRoot || streakRoot.dataset.bound) return;
  streakRoot.dataset.bound = '1';

  streakRoot.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'admin-refresh-streak') loadStreak();
    else if (t.id === 'admin-streak-abs-prev' && streakAbsPage > 1) { streakAbsPage--; loadStreakAbs(); }
    else if (t.id === 'admin-streak-abs-next') { streakAbsPage++; loadStreakAbs(); }
    else if (t.id === 'admin-streak-sessions-prev' && streakSessionsPage > 1) { streakSessionsPage--; loadStreakSessions(); }
    else if (t.id === 'admin-streak-sessions-next') { streakSessionsPage++; loadStreakSessions(); }
    else if (t.id === 'ingest-run-statcast') runIngestStatcast();
    else if (t.id === 'ingest-run-csv') runIngestCsv();
    else if (t.dataset.ingestTab) switchIngestTab(t.dataset.ingestTab);
  });

  streakRoot.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'admin-streak-ab-search' || t.id === 'admin-streak-ab-sort') { streakAbsPage = 1; loadStreakAbs(); }
    if (t.id === 'admin-streak-session-handle') { streakSessionsPage = 1; loadStreakSessions(); }
  });
}

function switchIngestTab(tab) {
  streakRoot.querySelectorAll('[data-ingest-tab]').forEach((b) =>
    b.classList.toggle('admin-seg__btn--active', b.dataset.ingestTab === tab));
  streakRoot.querySelectorAll('[data-ingest-pane]').forEach((p) =>
    p.classList.toggle('hidden', p.dataset.ingestPane !== tab));
}

function setIngestBusy(busy, label) {
  streakIngestBusy = busy;
  const btns = streakRoot.querySelectorAll('#ingest-run-statcast, #ingest-run-csv');
  btns.forEach((b) => { b.disabled = busy; });
  const result = document.getElementById('ingest-result');
  if (busy && result) {
    result.classList.remove('hidden');
    result.innerHTML = `<div class="admin-ingest-running"><span class="admin-spinner"></span> ${escapeHtml(label || 'Working…')}</div>`;
  }
}

async function runIngestStatcast() {
  if (streakIngestBusy) return;
  const startDt = document.getElementById('ingest-start')?.value;
  const endDt = document.getElementById('ingest-end')?.value;
  const team = document.getElementById('ingest-team')?.value || '';
  const minDifficulty = Number(document.getElementById('ingest-mindiff')?.value) || 0;
  if (!startDt || !endDt) { showAdminToast('Pick a start and end date', 'warn'); return; }
  if (startDt > endDt) { showAdminToast('Start date must be on or before end date', 'warn'); return; }

  setIngestBusy(true, `Fetching ${startDt} → ${endDt} from Statcast…`);
  try {
    const r = await api('/api/admin/streak', {
      method: 'POST',
      body: JSON.stringify({ action: 'ingest_statcast', startDt, endDt, team, minDifficulty }),
    });
    document.getElementById('ingest-result').innerHTML = renderIngestResult(r);
    showAdminToast(`Ingested ${r.inserted} ABs`, 'ok');
    await Promise.all([loadStreakDistribution(), loadStreakAbs(), refreshStreakOverview()]);
  } catch (err) {
    document.getElementById('ingest-result').innerHTML = `<p class="admin-status-err">${escapeHtml(err.message)}</p>`;
    showAdminToast(err.message, 'err');
  } finally {
    setIngestBusy(false);
  }
}

async function runIngestCsv() {
  if (streakIngestBusy) return;
  const csv = document.getElementById('ingest-csv')?.value || '';
  const minDifficulty = Number(document.getElementById('ingest-csv-mindiff')?.value) || 0;
  if (csv.trim().length < 40) { showAdminToast('Paste a CSV with a header row first', 'warn'); return; }

  setIngestBusy(true, 'Scoring & ingesting CSV…');
  try {
    const r = await api('/api/admin/streak', {
      method: 'POST',
      body: JSON.stringify({ action: 'ingest_csv', csv, minDifficulty }),
    });
    document.getElementById('ingest-result').innerHTML = renderIngestResult(r);
    showAdminToast(`Ingested ${r.inserted} ABs`, 'ok');
    await Promise.all([loadStreakDistribution(), loadStreakAbs(), refreshStreakOverview()]);
  } catch (err) {
    document.getElementById('ingest-result').innerHTML = `<p class="admin-status-err">${escapeHtml(err.message)}</p>`;
    showAdminToast(err.message, 'err');
  } finally {
    setIngestBusy(false);
  }
}

/* ---------- Loaders ---------- */

async function loadStreakAbs() {
  const search = document.getElementById('admin-streak-ab-search')?.value || '';
  const sort = document.getElementById('admin-streak-ab-sort')?.value || 'difficulty';
  const mount = document.getElementById('admin-streak-abs-mount');
  if (mount && !mount.dataset.loaded) mount.innerHTML = '<p class="admin-meta-line">Loading at-bats…</p>';
  const abs = await api(
    `/api/admin/streak?view=abs&page=${streakAbsPage}&limit=25&search=${encodeURIComponent(search)}&sort=${encodeURIComponent(sort)}`
  );
  if (mount) {
    mount.innerHTML = renderStreakAbsTable(abs.rows, abs.total, abs.page, abs.limit);
    mount.dataset.loaded = '1';
    const searchEl = document.getElementById('admin-streak-ab-search');
    if (searchEl) { searchEl.value = search; if (document.activeElement === document.body) searchEl.focus(); }
    const sortEl = document.getElementById('admin-streak-ab-sort');
    if (sortEl) sortEl.value = sort;
  }
}

async function loadStreakSessions() {
  const handle = document.getElementById('admin-streak-session-handle')?.value || '';
  const data = await api(
    `/api/admin/streak?view=sessions&page=${streakSessionsPage}&limit=25&handle=${encodeURIComponent(handle)}`
  );
  const mount = document.getElementById('admin-streak-sessions-mount');
  if (mount) {
    mount.innerHTML = renderStreakSessionsTable(data.rows, data.total, data.page, data.limit);
    const handleEl = document.getElementById('admin-streak-session-handle');
    if (handleEl) handleEl.value = handle;
  }
}

async function loadStreakDistribution() {
  try {
    streakDistribution = await api('/api/admin/streak?view=distribution');
  } catch {
    streakDistribution = null;
  }
  const mount = document.getElementById('admin-streak-distribution');
  if (mount) mount.innerHTML = renderStreakDistribution(streakDistribution);
}

async function refreshStreakOverview() {
  try {
    const dash = await api('/api/admin/streak');
    streakPanelData = { ...dash, distribution: streakDistribution };
    const mount = document.getElementById('admin-streak-overview');
    if (mount) mount.innerHTML = renderStreakOverview(streakPanelData);
  } catch { /* keep prior */ }
}

async function loadStreak() {
  if (!streakRoot) return;
  streakRoot.innerHTML = '<p class="admin-meta-line">Loading streak console…</p>';
  try {
    const dash = await api('/api/admin/streak');
    streakDistribution = await api('/api/admin/streak?view=distribution').catch(() => null);
    streakPanelData = { ...dash, distribution: streakDistribution };

    streakRoot.innerHTML = `
      <div id="admin-streak-overview">${renderStreakOverview(streakPanelData)}</div>
      <div id="admin-streak-distribution">${renderStreakDistribution(streakDistribution)}</div>
      ${renderStreakIngestControls()}
      <section class="admin-streak-card">
        <h3 class="admin-streak-card__title">At-bat pool</h3>
        <div id="admin-streak-abs-mount"></div>
      </section>
      <section class="admin-streak-card">
        <h3 class="admin-streak-card__title">Recent sessions</h3>
        <div id="admin-streak-sessions-mount"></div>
      </section>`;

    delete streakRoot.dataset.bound;
    bindStreakPanelEvents();
    await loadStreakAbs();
    await loadStreakSessions();
  } catch (err) {
    streakRoot.innerHTML = `<p class="admin-status-err">${escapeHtml(err.message)}</p>`;
    showAdminToast(err.message, 'err');
  }
}

checkSession();
