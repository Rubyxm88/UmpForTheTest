import '../admin.css';

const API = { credentials: 'include' };

function formatApiError(res, data) {
  if (data.error && data.error !== 'Internal Server Error') return data.error;
  if (res.status === 500 && (!data.error || data.error === 'Internal Server Error')) {
    return 'API unavailable — run npm run dev:full (or npm run dev:api in another terminal)';
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
      await loadUsers();
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
      await loadUsers();
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
    await loadUsers();
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

function setChallengeStatus(message, tone = 'ok') {
  const el = document.getElementById('admin-challenge-status');
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden', 'admin-status-ok', 'admin-status-warn', 'admin-status-err');
  el.classList.add(
    tone === 'err' ? 'admin-status-err' : tone === 'warn' ? 'admin-status-warn' : 'admin-status-ok'
  );
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

function renderGenerationForm(config) {
  const c = config || {};
  const games = c.games || {};
  const playlist = c.playlist || {};
  const filters = c.filters || {};
  const manualPks = (games.manualGamePks || []).join(', ');

  return `
    <form id="admin-gen-form" class="admin-gen-form">
      <label class="admin-gen-field admin-gen-field--wide">
        <span class="ump-label">Draft label</span>
        <input class="ump-input" name="label" type="text" value="${escapeHtml(c.label || '')}" />
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Schedule for week</span>
        <input class="ump-input" name="scheduleForWeekId" type="text" placeholder="2026-W22 (empty = current)" value="${escapeHtml(c.scheduleForWeekId || '')}" />
        <small>Pre-load a future ISO week before Monday reset.</small>
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Target at-bats</span>
        <input class="ump-input" name="targetAtBats" type="number" min="5" max="200" value="${playlist.targetAtBats ?? 20}" />
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Borderline mix (0–1)</span>
        <input class="ump-input" name="borderlineRatio" type="number" min="0" max="1" step="0.05" value="${playlist.borderlineRatio ?? 0.5}" />
        <small>Share of edge-case ABs in the playlist.</small>
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Edge threshold (ft)</span>
        <input class="ump-input" name="borderlineEdgeThresholdFt" type="number" min="0.05" max="0.5" step="0.01" value="${playlist.borderlineEdgeThresholdFt ?? 0.15}" />
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Games in bundle</span>
        <input class="ump-input" name="gameCount" type="number" min="1" max="10" value="${games.count ?? 5}" />
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Lookback days</span>
        <input class="ump-input" name="lookbackDays" type="number" min="1" max="30" value="${games.lookbackDays ?? 7}" />
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Game selection</span>
        <select class="ump-input" name="selectionMode">
          <option value="high_scoring_diverse" ${games.selectionMode === 'high_scoring_diverse' ? 'selected' : ''}>High scoring + diversity</option>
          <option value="latest_final" ${games.selectionMode === 'latest_final' ? 'selected' : ''}>Latest finals</option>
          <option value="manual_pks" ${games.selectionMode === 'manual_pks' ? 'selected' : ''}>Manual game PKs</option>
        </select>
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Min total runs</span>
        <input class="ump-input" name="minTotalRuns" type="number" min="0" max="30" value="${games.minTotalRuns ?? 0}" />
      </label>
      <label class="admin-gen-field admin-gen-field--wide">
        <span class="ump-label">Manual game PKs</span>
        <input class="ump-input" name="manualGamePks" type="text" placeholder="824839, 824840" value="${escapeHtml(manualPks)}" />
        <small>Comma-separated MLB game PKs when using manual selection.</small>
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Max ABs per game</span>
        <input class="ump-input" name="perGameCap" type="number" min="1" max="50" placeholder="optional" value="${playlist.perGameCap ?? ''}" />
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Favor late innings</span>
        <input name="prioritizeLateInning" type="checkbox" ${playlist.prioritizeLateInning ? 'checked' : ''} />
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Require called pitch</span>
        <input name="requireCalledPitch" type="checkbox" ${filters.requireCalledPitch !== false ? 'checked' : ''} />
      </label>
      <label class="admin-gen-field">
        <span class="ump-label">Exclude swing-only ABs</span>
        <input name="excludeSwingOnlyAbs" type="checkbox" ${filters.excludeSwingOnlyAbs ? 'checked' : ''} />
      </label>
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

function renderWeekDetail(data, weekId) {
  const slot = data.timeline.find((t) => t.weekId === weekId);
  if (!slot) return '<p class="admin-meta-line">Select a week from the schedule.</p>';

  const bundle = slot.bundle;
  const isCurrent = slot.period === 'current';
  const assignSelect = (data.catalog || [])
    .map(
      (b) =>
        `<option value="${escapeHtml(b.id)}" ${b.id === selectedBundleId ? 'selected' : ''}>${escapeHtml(b.label || b.id)} (${b.targetAtBats ?? '?'} AB)</option>`
    )
    .join('');

  return `
    <h3 class="admin-section__title">${escapeHtml(weekId)} <span class="admin-week-badge ${periodBadgeClass(slot.period)}">${periodLabel(slot.period)}</span></h3>
    <p class="admin-meta-line">Leaderboard entries: <strong>${slot.leaderboardEntries ?? '—'}</strong></p>
    ${
      bundle
        ? `<p class="admin-meta-line">Assigned: <strong>${escapeHtml(bundle.label || bundle.id)}</strong><br><code>${escapeHtml(bundle.id)}</code> · ${bundle.gameCount ?? 0} games · ${bundle.targetAtBats ?? '?'} AB playlist</p>`
        : '<p class="admin-meta-line admin-status-warn">No challenge assigned for this week.</p>'
    }
    <div class="admin-week-actions">
      <label class="admin-field admin-field--inline">
        <span class="ump-label">Bundle to assign</span>
        <select id="admin-assign-bundle-select" class="ump-input">${assignSelect || '<option value="">— No bundles —</option>'}</select>
      </label>
      <button type="button" class="ump-btn ump-btn--primary ump-btn--sm" data-action="assign-week" data-week="${escapeHtml(weekId)}">Assign to this week</button>
      ${
        isCurrent
          ? `<button type="button" class="ump-btn ump-btn--ghost ump-btn--sm" data-action="deploy-live" data-week="${escapeHtml(weekId)}">Deploy live app</button>
             <button type="button" class="ump-btn admin-btn--danger ump-btn--sm" data-action="reset-lb" data-week="${escapeHtml(weekId)}">Reset leaderboard</button>`
          : slot.period === 'past'
            ? ''
            : `<button type="button" class="ump-btn ump-btn--ghost ump-btn--sm" data-action="unassign-week" data-week="${escapeHtml(weekId)}">Clear assignment</button>`
      }
      ${bundle ? `<button type="button" class="ump-btn ump-btn--ghost ump-btn--sm" data-action="view-bundle" data-bundle="${escapeHtml(bundle.id)}">View playlist</button>` : ''}
    </div>
    ${
      isCurrent
        ? `<p class="admin-meta-line"><small>Assigning a different bundle to <strong>this week</strong> resets the weekly leaderboard and updates the live player file.</small></p>`
        : ''
    }
    <div id="admin-bundle-detail" class="admin-preview-box hidden"></div>
  `;
}

function renderChallengesPanel(data) {
  if (!selectedWeekId) {
    selectedWeekId = data.currentIsoWeek;
  }

  const live = data.live || {};
  const liveStatus = live.meta
    ? live.weekAligned
      ? '<span class="health-ok">Live file matches calendar week</span>'
      : '<span class="health-warn">Live file week ≠ calendar week</span>'
    : '<span class="health-warn">No live weekly_challenge.js</span>';

  const timelineRows = (data.timeline || [])
    .map((slot) => {
      const sel = slot.weekId === selectedWeekId ? ' admin-week-row--selected' : '';
      const bundleLabel = slot.bundle
        ? escapeHtml(slot.bundle.label || slot.bundle.id)
        : '<span class="admin-table__muted">Unassigned</span>';
      return `
        <tr class="admin-week-row${sel}" data-week="${escapeHtml(slot.weekId)}" tabindex="0" role="button">
          <td><span class="admin-week-badge ${periodBadgeClass(slot.period)}">${periodLabel(slot.period)}</span></td>
          <td><strong>${escapeHtml(slot.weekId)}</strong></td>
          <td>${bundleLabel}</td>
          <td>${slot.leaderboardEntries ?? '—'}</td>
        </tr>`;
    })
    .join('');

  const catalogRows = (data.catalog || [])
    .map((b) => {
      const sel = b.id === selectedBundleId ? ' admin-bundle-row--selected' : '';
      return `
        <tr class="admin-bundle-row${sel}" data-bundle="${escapeHtml(b.id)}" tabindex="0" role="button">
          <td>${escapeHtml(b.label || b.id)}</td>
          <td><code>${escapeHtml(b.id)}</code></td>
          <td>${b.gameCount ?? 0}</td>
          <td>${b.targetAtBats ?? '—'}</td>
          <td>${b.pitchCount ?? '—'}</td>
        </tr>`;
    })
    .join('');

  return `
    <p id="admin-challenge-status" class="admin-meta-line hidden" aria-live="polite"></p>
    <div class="admin-challenges-header ump-panel--subtle">
      <div>
        <p class="ump-kicker">Calendar week</p>
        <p class="admin-challenges-header__week">${escapeHtml(data.currentIsoWeek)}</p>
      </div>
      <div class="admin-challenges-header__meta">
        ${liveStatus}
        <span class="${data.writable ? 'health-ok' : 'health-warn'}">${data.writable ? 'Can write bundles' : 'Read-only — assign locally'}</span>
      </div>
      <button type="button" id="admin-refresh-challenges" class="ump-btn ump-btn--ghost ump-btn--sm">Refresh</button>
    </div>

    <section class="admin-section">
      <h3 class="admin-section__title">Schedule</h3>
      <p class="admin-meta-line">5 upcoming weeks · current · 12 past. Click a row to manage that week.</p>
      <div class="admin-table-wrap">
        <table class="admin-table admin-table--compact admin-week-table">
          <thead>
            <tr><th>When</th><th>ISO week</th><th>Challenge bundle</th><th>LB entries</th></tr>
          </thead>
          <tbody>${timelineRows}</tbody>
        </table>
      </div>
    </section>

    <div class="admin-challenges-split">
      <section class="admin-section admin-section--half" id="admin-week-panel">
        ${renderWeekDetail(data, selectedWeekId)}
      </section>
      <section class="admin-section admin-section--half">
        <h3 class="admin-section__title">Bundle library</h3>
        <p class="admin-meta-line">Generate once, assign to any week. Click a row to preview.</p>
        <div class="admin-toolbar admin-toolbar--wrap">
          <button type="button" id="admin-generate-bundle" class="ump-btn ump-btn--primary ump-btn--sm">Generate new bundle</button>
          <button type="button" id="admin-preview-generate" class="ump-btn ump-btn--ghost ump-btn--sm">Quick preview (2 games)</button>
        </div>
        <div class="admin-table-wrap admin-table-wrap--nested">
          <table class="admin-table admin-table--compact">
            <thead><tr><th>Label</th><th>ID</th><th>Games</th><th>ABs</th><th>Pitches</th></tr></thead>
            <tbody>${catalogRows || '<tr><td colspan="5">No bundles yet — generate one below.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    </div>

    <details class="admin-generator-details">
      <summary class="admin-section__title">Generator settings</summary>
      ${renderGenerationForm(data.config)}
      <div class="admin-toolbar admin-toolbar--wrap">
        <button type="button" id="admin-save-challenge-config" class="ump-btn ump-btn--ghost ump-btn--sm">Save defaults</button>
      </div>
      <div id="admin-challenge-preview" class="admin-preview-box hidden"></div>
    </details>
  `;
}

function bindChallengesPanelEvents() {
  document.getElementById('admin-refresh-challenges')?.addEventListener('click', () => {
    setChallengeStatus('');
    loadChallenges();
  });

  challengesRoot?.querySelectorAll('.admin-week-row').forEach((row) => {
    row.addEventListener('click', () => {
      selectedWeekId = row.getAttribute('data-week');
      if (challengePanelData) {
        document.getElementById('admin-week-panel').innerHTML = renderWeekDetail(
          challengePanelData,
          selectedWeekId
        );
        bindWeekPanelEvents();
        challengesRoot.querySelectorAll('.admin-week-row').forEach((r) => {
          r.classList.toggle('admin-week-row--selected', r.getAttribute('data-week') === selectedWeekId);
        });
      }
    });
  });

  challengesRoot?.querySelectorAll('.admin-bundle-row').forEach((row) => {
    row.addEventListener('click', async () => {
      selectedBundleId = row.getAttribute('data-bundle');
      challengesRoot.querySelectorAll('.admin-bundle-row').forEach((r) => {
        r.classList.toggle('admin-bundle-row--selected', r.getAttribute('data-bundle') === selectedBundleId);
      });
      const sel = document.getElementById('admin-assign-bundle-select');
      if (sel) sel.value = selectedBundleId;
      await viewBundle(selectedBundleId);
    });
  });

  document.getElementById('admin-generate-bundle')?.addEventListener('click', onGenerateBundle);
  document.getElementById('admin-preview-generate')?.addEventListener('click', onPreviewGenerate);
  document.getElementById('admin-save-challenge-config')?.addEventListener('click', onSaveConfig);
  bindWeekPanelEvents();
}

function bindWeekPanelEvents() {
  document.querySelectorAll('[data-action="assign-week"]').forEach((btn) => {
    btn.addEventListener('click', () => onAssignWeek(btn.getAttribute('data-week')));
  });
  document.querySelectorAll('[data-action="deploy-live"]').forEach((btn) => {
    btn.addEventListener('click', () => onDeployLive(btn.getAttribute('data-week')));
  });
  document.querySelectorAll('[data-action="reset-lb"]').forEach((btn) => {
    btn.addEventListener('click', () => onResetLeaderboard(btn.getAttribute('data-week')));
  });
  document.querySelectorAll('[data-action="unassign-week"]').forEach((btn) => {
    btn.addEventListener('click', () => onUnassignWeek(btn.getAttribute('data-week')));
  });
  document.querySelectorAll('[data-action="view-bundle"]').forEach((btn) => {
    btn.addEventListener('click', () => viewBundle(btn.getAttribute('data-bundle')));
  });
}

async function viewBundle(bundleId) {
  if (!bundleId) return;
  const box = document.getElementById('admin-bundle-detail');
  if (!box) return;
  box.classList.remove('hidden');
  box.textContent = 'Loading playlist…';
  try {
    const result = await api('/api/admin/challenges', {
      method: 'POST',
      body: JSON.stringify({ action: 'getBundle', bundleId }),
    });
    const d = result.detail;
    const ps = d.playlistStats || {};
    const abRows = (d.atBatsPreview || [])
      .map(
        (ab, i) =>
          `<tr><td>${i + 1}</td><td>${escapeHtml(ab.gameTitle)}</td><td>${escapeHtml(ab.batter)}</td><td>${escapeHtml(ab.pitcher)}</td><td>${ab.pitchCount}</td></tr>`
      )
      .join('');
    box.innerHTML = `
      <p><strong>${escapeHtml(d.label)}</strong> · Playlist <strong>${ps.selectedAbs}/${ps.targetAtBats}</strong> ABs</p>
      <p class="admin-meta-line">Games: ${(d.games || []).map((g) => escapeHtml(g.title)).join(' · ')}</p>
      <div class="admin-table-wrap admin-table-wrap--nested">
        <table class="admin-table admin-table--compact">
          <thead><tr><th>#</th><th>Game</th><th>Batter</th><th>Pitcher</th><th>Pitches</th></tr></thead>
          <tbody>${abRows}</tbody>
        </table>
      </div>
      ${d.atBatTotal > 40 ? `<p class="admin-meta-line">Showing first 40 of ${d.atBatTotal} ABs in pool.</p>` : ''}
    `;
  } catch (err) {
    box.textContent = err.message;
  }
}

async function onAssignWeek(weekId) {
  const sel = document.getElementById('admin-assign-bundle-select');
  const bundleId = sel?.value || selectedBundleId;
  if (!bundleId) {
    setChallengeStatus('Pick a bundle first', 'err');
    return;
  }
  const isCurrent = weekId === challengePanelData?.currentIsoWeek;
  const msg = isCurrent
    ? `Assign "${bundleId}" to CURRENT week ${weekId}? This resets the weekly leaderboard and updates the live game file.`
    : `Assign "${bundleId}" to ${weekId}?`;
  if (!window.confirm(msg)) return;

  try {
    setChallengeStatus('Assigning…', 'warn');
    const result = await api('/api/admin/challenges', {
      method: 'POST',
      body: JSON.stringify({ action: 'assignWeek', weekId, bundleId, deployLive: true, resetLeaderboard: true }),
    });
    setChallengeStatus(result.message || 'Assigned', 'ok');
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
  const weekInput = selectedWeekId || challengePanelData?.currentIsoWeek;
  try {
    setChallengeStatus('Generating bundle from MLB (~30s)…', 'warn');
    const result = await postChallengeAction('generateBundle', {
      weekId: weekInput,
      label: `Bundle for ${weekInput}`,
    });
    selectedBundleId = result.bundleId;
    setChallengeStatus(`Created ${result.bundleId}`, 'ok');
    await loadChallenges();
    await viewBundle(result.bundleId);
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  }
}

async function onPreviewGenerate() {
  try {
    setChallengeStatus('Preview…', 'warn');
    const result = await postChallengeAction('previewGenerate', { maxGames: 2 });
    const box = document.getElementById('admin-challenge-preview');
    if (box) {
      const ps = result.playlistStats || {};
      box.innerHTML = `<p>Would build <strong>${ps.selectedAbs}/${ps.targetAtBats}</strong> AB playlist · ${result.note || ''}</p>`;
      box.classList.remove('hidden');
    }
    setChallengeStatus('Preview done', 'ok');
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  }
}

async function onSaveConfig() {
  try {
    await postChallengeAction('saveConfig');
    setChallengeStatus('Generator defaults saved', 'ok');
  } catch (err) {
    setChallengeStatus(err.message, 'err');
  }
}

async function loadChallenges() {
  if (!challengesRoot) return;
  challengesRoot.innerHTML = '<p class="admin-meta-line">Loading…</p>';
  try {
    const data = await api('/api/admin/challenges');
    challengePanelData = data;
    if (!selectedWeekId) selectedWeekId = data.currentIsoWeek;
    challengesRoot.innerHTML = renderChallengesPanel(data);
    bindChallengesPanelEvents();
  } catch (err) {
    challengesRoot.innerHTML = `<p class="admin-status-err">${escapeHtml(err.message || 'Failed to load')}</p>`;
  }
}

checkSession();
