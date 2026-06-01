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
let activeChallengeStep = 'build';
let reviewBundleDetail = null;

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

function renderReviewPanel(data) {
  const bundleMeta = (data.catalog || []).find((b) => b.id === selectedBundleId);
  const used = bundleMeta?.usedByWeeks || [];
  const canDelete = bundleMeta && used.length === 0;
  const d = reviewBundleDetail;

  const assignOptions = (data.catalog || [])
    .map(
      (b) =>
        `<option value="${escapeHtml(b.id)}" ${b.id === selectedBundleId ? 'selected' : ''}>${escapeHtml(b.label || b.id)}</option>`
    )
    .join('');

  const weekOptions = (data.timeline || [])
    .map((t) => `<option value="${escapeHtml(t.weekId)}" ${t.weekId === selectedWeekId ? 'selected' : ''}>${escapeHtml(t.weekId)} (${periodLabel(t.period)})</option>`)
    .join('');

  let playlistHtml = '<p class="admin-meta-line">Select a bundle from the library or build a new one to review its playlist.</p>';
  if (d) {
    const ps = d.playlistStats || {};
    const abRows = (d.atBatsPreview || [])
      .map(
        (ab, i) =>
          `<tr><td>${i + 1}</td><td>${escapeHtml(ab.gameTitle)}</td><td>${escapeHtml(ab.batter)}</td><td>${escapeHtml(ab.pitcher)}</td><td>${ab.pitchCount}</td></tr>`
      )
      .join('');
    playlistHtml = `
      <div class="admin-review-kpis">
        <span><strong>${ps.selectedAbs ?? '?'}</strong> / ${ps.targetAtBats ?? '?'} playlist ABs</span>
        <span>${(d.games || []).length} games</span>
        <span>${d.atBatTotal ?? 0} ABs in pool</span>
      </div>
      <p class="admin-meta-line">${(d.games || []).map((g) => escapeHtml(g.title)).join(' · ')}</p>
      <div class="admin-table-wrap admin-table-wrap--nested">
        <table class="admin-table admin-table--compact">
          <thead><tr><th>#</th><th>Game</th><th>Batter</th><th>Pitcher</th><th>Px</th></tr></thead>
          <tbody>${abRows}</tbody>
        </table>
      </div>
      ${d.atBatTotal > 50 ? `<p class="admin-meta-line">First 50 of ${d.atBatTotal} ABs in source pool.</p>` : ''}`;
  }

  const usedBadges =
    used.length > 0
      ? used.map((w) => `<span class="admin-used-badge">${escapeHtml(w)}</span>`).join('')
      : '<span class="admin-table__muted">Not assigned to any week</span>';

  return `
    <div class="admin-review-header">
      <div>
        <h3 class="admin-section__title">${bundleMeta ? escapeHtml(bundleMeta.label || bundleMeta.id) : 'No bundle selected'}</h3>
        ${bundleMeta ? `<code class="admin-review-id">${escapeHtml(bundleMeta.id)}</code>` : ''}
      </div>
      <div class="admin-review-badges">
        <span class="ump-label">Assigned weeks</span>
        <div class="admin-used-badges">${usedBadges}</div>
      </div>
    </div>
    <div class="admin-review-actions">
      <label class="admin-gen-field">
        <span class="ump-label">Bundle</span>
        <select id="admin-review-bundle-select" class="ump-input">${assignOptions || '<option value="">—</option>'}</select>
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Assign to week</span>
        <select id="admin-review-week-select" class="ump-input">${weekOptions}</select>
      </label>
      <button type="button" id="admin-review-assign" class="ump-btn ump-btn--primary ump-btn--sm" ${!selectedBundleId ? 'disabled' : ''}>Assign</button>
      ${
        canDelete
          ? '<button type="button" id="admin-review-delete" class="ump-btn admin-btn--danger ump-btn--sm">Delete unused bundle</button>'
          : used.length
            ? '<span class="admin-meta-line">Unassign from all weeks before deleting.</span>'
            : ''
      }
    </div>
    <div id="admin-review-playlist" class="admin-review-playlist">${playlistHtml}</div>
  `;
}

function renderLibraryRows(catalog) {
  return (catalog || [])
    .map((b) => {
      const sel = b.id === selectedBundleId ? ' admin-bundle-row--selected' : '';
      const used =
        b.usedByWeeks?.length > 0
          ? b.usedByWeeks.map((w) => escapeHtml(w)).join(', ')
          : '—';
      return `
        <tr class="admin-bundle-row${sel}" data-bundle="${escapeHtml(b.id)}" tabindex="0" role="button">
          <td>${escapeHtml(b.label || b.id)}</td>
          <td>${b.targetAtBats ?? '—'} AB</td>
          <td>${b.gameCount ?? 0}</td>
          <td class="admin-table__muted">${used}</td>
        </tr>`;
    })
    .join('');
}

function renderScheduleTable(data) {
  return (data.timeline || [])
    .map((slot) => {
      const sel = slot.weekId === selectedWeekId ? ' admin-week-row--selected' : '';
      const bundleLabel = slot.bundle
        ? escapeHtml(slot.bundle.label || slot.bundle.id)
        : '<span class="admin-table__muted">—</span>';
      return `
        <tr class="admin-week-row${sel}" data-week="${escapeHtml(slot.weekId)}" tabindex="0" role="button">
          <td><span class="admin-week-badge ${periodBadgeClass(slot.period)}">${periodLabel(slot.period)}</span></td>
          <td><strong>${escapeHtml(slot.weekId)}</strong></td>
          <td>${bundleLabel}</td>
          <td>${slot.leaderboardEntries ?? '—'}</td>
        </tr>`;
    })
    .join('');
}

function renderChallengesPanel(data) {
  if (!selectedWeekId) selectedWeekId = data.currentIsoWeek;

  const storageBanner = data.canPersistBundles
    ? `<span class="health-ok">Storage: ${escapeHtml(data.storageMode || 'ok')} — bundles save to database</span>`
    : `<span class="health-warn">Storage unavailable — set Supabase env vars on this deployment</span>`;

  const live = data.live || {};
  const liveLine = live.meta
    ? live.weekAligned
      ? 'Live player file matches this calendar week'
      : 'Live player file is for a different week than today'
    : 'No live weekly_challenge.js in build';

  const step = (id, label, key) =>
    `<button type="button" class="admin-stepper__btn ${activeChallengeStep === key ? 'admin-stepper__btn--active' : ''}" data-step="${key}">${id}. ${label}</button>`;

  return `
    <div class="admin-challenge-layout">
      <header class="admin-challenges-header ump-panel--subtle">
        <div>
          <p class="ump-kicker">Today</p>
          <p class="admin-challenges-header__week">${escapeHtml(data.currentIsoWeek)}</p>
          <p class="admin-meta-line">${escapeHtml(liveLine)}</p>
        </div>
        <div class="admin-challenges-header__meta">
          ${storageBanner}
          <button type="button" id="admin-refresh-challenges" class="ump-btn ump-btn--ghost ump-btn--sm">Refresh</button>
        </div>
      </header>

      <nav class="admin-stepper" aria-label="Workflow">
        ${step(1, 'Customize & build', 'build')}
        ${step(2, 'Review playlist', 'review')}
        ${step(3, 'Week schedule', 'schedule')}
      </nav>

      <section id="admin-step-build" class="admin-step-panel ${activeChallengeStep === 'build' ? '' : 'hidden'}">
        <h3 class="admin-section__title">Customize, then build</h3>
        <p class="admin-meta-line">Tune the playlist and MLB sources, then fetch games. Build takes ~30 seconds.</p>
        ${renderGenerationForm(data.config, selectedWeekId)}
        <div class="admin-build-actions">
          <button type="button" id="admin-preview-generate" class="ump-btn ump-btn--ghost">Quick preview (2 games)</button>
          <button type="button" id="admin-generate-bundle" class="ump-btn ump-btn--primary">Build full bundle</button>
        </div>
        <div id="admin-preview-result" class="admin-preview-box hidden"></div>
        <h4 class="admin-subtitle">Saved bundles</h4>
        <div class="admin-table-wrap admin-table-wrap--nested">
          <table class="admin-table admin-table--compact">
            <thead><tr><th>Name</th><th>Playlist</th><th>Games</th><th>Used by weeks</th></tr></thead>
            <tbody>${renderLibraryRows(data.catalog) || '<tr><td colspan="4">No bundles yet.</td></tr>'}</tbody>
          </table>
        </div>
      </section>

      <section id="admin-step-review" class="admin-step-panel ${activeChallengeStep === 'review' ? '' : 'hidden'}">
        ${renderReviewPanel(data)}
      </section>

      <section id="admin-step-schedule" class="admin-step-panel ${activeChallengeStep === 'schedule' ? '' : 'hidden'}">
        <h3 class="admin-section__title">Assign challenges to weeks</h3>
        <p class="admin-meta-line">5 weeks ahead · current · 12 past. Reassigning <strong>this week</strong> resets the weekly leaderboard.</p>
        <div class="admin-table-wrap">
          <table class="admin-table admin-table--compact">
            <thead><tr><th>When</th><th>Week</th><th>Bundle</th><th>Leaderboard</th></tr></thead>
            <tbody>${renderScheduleTable(data)}</tbody>
          </table>
        </div>
        <div id="admin-schedule-week-actions" class="admin-week-actions hidden"></div>
      </section>
    </div>
  `;
}

function switchChallengeStep(step) {
  activeChallengeStep = step;
  document.querySelectorAll('.admin-step-panel').forEach((el) => el.classList.add('hidden'));
  document.getElementById(`admin-step-${step}`)?.classList.remove('hidden');
  document.querySelectorAll('.admin-stepper__btn').forEach((btn) => {
    btn.classList.toggle('admin-stepper__btn--active', btn.getAttribute('data-step') === step);
  });
}

function bindChallengesPanelEvents() {
  document.getElementById('admin-refresh-challenges')?.addEventListener('click', () => {
    showAdminToast('');
    loadChallenges();
  });

  challengesRoot?.querySelectorAll('.admin-stepper__btn').forEach((btn) => {
    btn.addEventListener('click', () => switchChallengeStep(btn.getAttribute('data-step')));
  });

  challengesRoot?.querySelectorAll('.admin-bundle-row').forEach((row) => {
    row.addEventListener('click', async () => {
      selectedBundleId = row.getAttribute('data-bundle');
      await loadBundleReview(selectedBundleId);
      switchChallengeStep('review');
      refreshReviewPanelOnly();
    });
  });

  challengesRoot?.querySelectorAll('.admin-week-row').forEach((row) => {
    row.addEventListener('click', () => {
      selectedWeekId = row.getAttribute('data-week');
      switchChallengeStep('schedule');
      updateScheduleWeekActions();
      challengesRoot.querySelectorAll('.admin-week-row').forEach((r) => {
        r.classList.toggle('admin-week-row--selected', r.getAttribute('data-week') === selectedWeekId);
      });
    });
  });

  document.getElementById('admin-generate-bundle')?.addEventListener('click', onGenerateBundle);
  document.getElementById('admin-preview-generate')?.addEventListener('click', onPreviewGenerate);
  document.getElementById('admin-review-assign')?.addEventListener('click', onReviewAssign);
  document.getElementById('admin-review-delete')?.addEventListener('click', onDeleteBundle);
  document.getElementById('admin-review-bundle-select')?.addEventListener('change', (e) => {
    selectedBundleId = e.target.value;
    loadBundleReview(selectedBundleId).then(refreshReviewPanelOnly);
  });
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
      selectedBundleId = slot.bundle.id;
      loadBundleReview(selectedBundleId).then(() => {
        switchChallengeStep('review');
        refreshReviewPanelOnly();
      });
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
    return;
  }
  const result = await api('/api/admin/challenges', {
    method: 'POST',
    body: JSON.stringify({ action: 'getBundle', bundleId }),
  });
  reviewBundleDetail = result.detail;
}

function refreshReviewPanelOnly() {
  const el = document.getElementById('admin-step-review');
  if (el && challengePanelData) {
    el.innerHTML = renderReviewPanel(challengePanelData);
    document.getElementById('admin-review-assign')?.addEventListener('click', onReviewAssign);
    document.getElementById('admin-review-delete')?.addEventListener('click', onDeleteBundle);
    document.getElementById('admin-review-bundle-select')?.addEventListener('change', (e) => {
      selectedBundleId = e.target.value;
      loadBundleReview(selectedBundleId).then(refreshReviewPanelOnly);
    });
  }
}

async function onReviewAssign() {
  const bundleId = document.getElementById('admin-review-bundle-select')?.value || selectedBundleId;
  const weekId = document.getElementById('admin-review-week-select')?.value || selectedWeekId;
  if (!bundleId || !weekId) {
    setChallengeStatus('Choose a bundle and a week', 'err');
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

  const btn = document.getElementById('admin-review-assign');
  if (btn) btn.disabled = true;
  try {
    setChallengeStatus('Assigning…', 'warn');
    const result = await api('/api/admin/challenges', {
      method: 'POST',
      body: JSON.stringify({ action: 'assignWeek', weekId, bundleId, deployLive: true, resetLeaderboard: true }),
    });
    setChallengeStatus(result.message || 'Assigned', 'ok');
    await loadChallenges();
    switchChallengeStep('review');
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  } finally {
    if (btn) btn.disabled = false;
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
    setChallengeStatus(`Built “${label}”. Review the playlist, then assign to a week.`, 'ok');
    await loadChallenges();
    switchChallengeStep('review');
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

async function loadChallenges() {
  if (!challengesRoot) return;
  challengesRoot.innerHTML = '<p class="admin-meta-line">Loading…</p>';
  try {
    const data = await api('/api/admin/challenges');
    challengePanelData = data;
    if (!selectedWeekId) selectedWeekId = data.currentIsoWeek;
    if (selectedBundleId) {
      try {
        await loadBundleReview(selectedBundleId);
      } catch {
        reviewBundleDetail = null;
      }
    }
    challengesRoot.innerHTML = renderChallengesPanel(data);
    bindChallengesPanelEvents();
    switchChallengeStep(activeChallengeStep);
    if (activeChallengeStep === 'schedule') updateScheduleWeekActions();
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
let streakAbsPage = 1;
let streakSessionsPage = 1;

function renderStreakReadiness(data) {
  const steps = data.readiness?.steps || [];
  const items = steps
    .map(
      (s) =>
        `<li class="admin-streak-step ${s.done ? 'admin-streak-step--done' : ''}"><strong>${s.done ? '✓' : '○'}</strong> ${escapeHtml(s.label)}${s.detail ? ` <span class="admin-meta-line">(${escapeHtml(s.detail)})</span>` : ''}</li>`
    )
    .join('');
  const phase = data.readiness?.phase || 'unknown';
  const phaseLabel = {
    bundle_only: 'Bundle only (client ships ABs in JS)',
    partial_ingest: 'Partial DB pool',
    supabase_pool: 'Supabase pool active',
  }[phase] || phase;

  return `
    <header class="admin-challenges-header ump-panel--subtle">
      <div>
        <h2 class="ump-title ump-title--sm">Streak pool</h2>
        <p class="admin-meta-line">20k+ path: ingest → client fetches by ID → telemetry fills admin stats</p>
      </div>
      <button type="button" id="admin-refresh-streak" class="ump-btn ump-btn--ghost ump-btn--sm">Refresh</button>
    </header>
    <div class="admin-kpi-row">
      <div class="admin-kpi"><span class="admin-kpi__label">Phase</span><span class="admin-kpi__value">${escapeHtml(phaseLabel)}</span></div>
      <div class="admin-kpi"><span class="admin-kpi__label">DB pool (eligible)</span><span class="admin-kpi__value">${data.poolCount ?? 0} (${data.eligibleCount ?? 0})</span></div>
      <div class="admin-kpi"><span class="admin-kpi__label">Build bundle</span><span class="admin-kpi__value">${data.bundleMeta?.totalAbs ?? '—'} ABs</span></div>
      <div class="admin-kpi"><span class="admin-kpi__label">Sessions logged</span><span class="admin-kpi__value">${data.sessionCount ?? 0}</span></div>
      <div class="admin-kpi"><span class="admin-kpi__label">ABs with stats</span><span class="admin-kpi__value">${data.statsRowCount ?? 0}</span></div>
    </div>
    <section class="admin-section">
      <h3 class="admin-section__title">Readiness checklist</h3>
      <ul class="admin-streak-checklist">${items || '<li>Loading…</li>'}</ul>
      <p class="admin-meta-line">Ingest: <code>npm run streak-pool:ingest</code> (from machine with service role key). Vercel production needs migrations applied first.</p>
    </section>`;
}

function renderStreakAbsTable(rows, total, page, limit) {
  if (!rows?.length) {
    return '<p class="admin-meta-line">No ABs in Supabase yet — run ingest or play streak (telemetry creates stat rows for served ABs).</p>';
  }
  const body = rows
    .map((r) => {
      const s = r.stats || {};
      const acc =
        s.pitches_seen > 0
          ? `${Math.round((100 * (s.correct_calls || 0)) / s.pitches_seen)}%`
          : '—';
      return `<tr>
        <td class="admin-table__mono admin-table__truncate" title="${escapeHtml(r.id)}">${escapeHtml(r.id.slice(0, 36))}${r.id.length > 36 ? '…' : ''}</td>
        <td>${escapeHtml(r.pitcher || '—')} vs ${escapeHtml(r.batter || '—')}</td>
        <td>${r.difficulty ?? '—'}</td>
        <td>${s.times_served ?? 0}</td>
        <td>${s.times_completed ?? 0}</td>
        <td>${s.pitches_seen ?? 0}</td>
        <td>${acc}</td>
        <td>${formatDate(s.last_played_at)}</td>
      </tr>`;
    })
    .join('');
  const pages = Math.max(1, Math.ceil(total / limit));
  return `
    <div class="admin-toolbar">
      <input id="admin-streak-ab-search" type="search" class="ump-input admin-input--search" placeholder="Search pitcher, batter, id…" />
      <select id="admin-streak-ab-sort" class="ump-input">
        <option value="times_served">Most played</option>
        <option value="difficulty">Difficulty</option>
        <option value="last_used">Last used</option>
        <option value="id">ID</option>
      </select>
      <button type="button" id="admin-streak-abs-prev" class="ump-btn ump-btn--ghost ump-btn--sm" ${page <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="admin-meta-line">Page ${page} / ${pages} (${total} total)</span>
      <button type="button" id="admin-streak-abs-next" class="ump-btn ump-btn--ghost ump-btn--sm" ${page >= pages ? 'disabled' : ''}>Next</button>
    </div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>
          <th>AB id</th><th>Matchup</th><th>Diff</th><th>Served</th><th>Completed</th><th>Pitches</th><th>Accuracy</th><th>Last played</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function renderStreakSessionsTable(rows, total, page, limit) {
  if (!rows?.length) {
    return '<p class="admin-meta-line">No streak sessions recorded yet. Logged-in players send data when a streak run ends.</p>';
  }
  const body = rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.handle)}</td>
        <td>${escapeHtml(r.date_key)}</td>
        <td>${r.correct_streak}</td>
        <td>${r.abs_played}</td>
        <td>${r.correct_pitches}/${r.pitches_called}</td>
        <td class="admin-table__mono admin-table__truncate">${escapeHtml((r.used_ab_ids || []).slice(0, 3).join(', '))}${(r.used_ab_ids?.length || 0) > 3 ? '…' : ''}</td>
        <td>${formatDate(r.ended_at)}</td>
      </tr>`
    )
    .join('');
  const pages = Math.max(1, Math.ceil(total / limit));
  return `
    <div class="admin-toolbar">
      <input id="admin-streak-session-handle" type="search" class="ump-input admin-input--search" placeholder="Filter handle…" />
      <button type="button" id="admin-streak-sessions-prev" class="ump-btn ump-btn--ghost ump-btn--sm" ${page <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="admin-meta-line">Page ${page} / ${pages}</span>
      <button type="button" id="admin-streak-sessions-next" class="ump-btn ump-btn--ghost ump-btn--sm" ${page >= pages ? 'disabled' : ''}>Next</button>
    </div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Player</th><th>Date</th><th>Streak</th><th>ABs</th><th>Pitches</th><th>AB ids</th><th>Ended</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function bindStreakPanelEvents() {
  if (!streakRoot || streakRoot.dataset.bound) return;
  streakRoot.dataset.bound = '1';
  streakRoot.addEventListener('click', (e) => {
    const t = e.target;
    if (t.id === 'admin-refresh-streak') loadStreak();
    if (t.id === 'admin-streak-abs-prev' && streakAbsPage > 1) {
      streakAbsPage--;
      loadStreakAbs();
    }
    if (t.id === 'admin-streak-abs-next') {
      streakAbsPage++;
      loadStreakAbs();
    }
    if (t.id === 'admin-streak-sessions-prev' && streakSessionsPage > 1) {
      streakSessionsPage--;
      loadStreakSessions();
    }
    if (t.id === 'admin-streak-sessions-next') {
      streakSessionsPage++;
      loadStreakSessions();
    }
  });
  streakRoot.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'admin-streak-ab-search' || t.id === 'admin-streak-ab-sort') {
      streakAbsPage = 1;
      loadStreakAbs();
    }
    if (t.id === 'admin-streak-session-handle') {
      streakSessionsPage = 1;
      loadStreakSessions();
    }
  });
}

async function loadStreakAbs() {
  const search = document.getElementById('admin-streak-ab-search')?.value || '';
  const sort = document.getElementById('admin-streak-ab-sort')?.value || 'times_served';
  const abs = await api(
    `/api/admin/streak?view=abs&page=${streakAbsPage}&limit=50&search=${encodeURIComponent(search)}&sort=${encodeURIComponent(sort)}`
  );
  const mount = document.getElementById('admin-streak-abs-mount');
  if (mount) {
    mount.innerHTML = renderStreakAbsTable(abs.rows, abs.total, abs.page, abs.limit);
  }
}

async function loadStreakSessions() {
  const handle = document.getElementById('admin-streak-session-handle')?.value || '';
  const data = await api(
    `/api/admin/streak?view=sessions&page=${streakSessionsPage}&limit=30&handle=${encodeURIComponent(handle)}`
  );
  const mount = document.getElementById('admin-streak-sessions-mount');
  if (mount) {
    mount.innerHTML = renderStreakSessionsTable(data.rows, data.total, data.page, data.limit);
  }
}

async function loadStreak() {
  if (!streakRoot) return;
  streakRoot.innerHTML = '<p class="admin-meta-line">Loading…</p>';
  try {
    const dash = await api('/api/admin/streak');
    streakPanelData = dash;
    streakRoot.innerHTML = `${renderStreakReadiness(dash)}
      <section class="admin-section"><h3 class="admin-section__title">At-bats (Supabase + play stats)</h3><div id="admin-streak-abs-mount"></div></section>
      <section class="admin-section"><h3 class="admin-section__title">Streak sessions</h3><div id="admin-streak-sessions-mount"></div></section>`;
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
