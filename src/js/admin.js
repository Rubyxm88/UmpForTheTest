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
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${Math.round(Number(n))}%`;
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
const challengesReport = document.getElementById('admin-challenges-report');

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
  const withAccuracy = rows.filter((u) => u.stats?.overall_accuracy != null);
  const avgAccuracy = withAccuracy.length
    ? Math.round(
        withAccuracy.reduce((sum, u) => sum + Number(u.stats.overall_accuracy), 0) /
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
            <td>${formatPct(s.overall_accuracy)}</td>
            <td>${s.max_streak ?? 0}</td>
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

  const leaderboardRows = entries.length
    ? entries
        .map(
          (e) => `
        <tr>
          <td>${escapeHtml(formatBoard(e.board))}</td>
          <td>${escapeHtml(e.period_key)}</td>
          <td>${escapeHtml(e.score_text || e.score_raw)}</td>
          <td>${escapeHtml(e.accuracy ?? '—')}</td>
          <td class="admin-table__muted">${formatDate(e.submitted_at)}</td>
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
          <span class="admin-kpi__value">${formatPct(stats.overallAccuracy)}</span>
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

async function loadChallenges() {
  if (!challengesReport) return;
  challengesReport.textContent = 'Loading…';
  try {
    const data = await api('/api/admin/challenges');
    const h = data.health || {};
    const healthHtml = [
      healthBadge(h.hasFiveGames, '5 games'),
      healthBadge(h.hasPitches, 'Pitches'),
      healthBadge(h.weekIdPresent, 'Week ID'),
      healthBadge(h.gamePksPresent, 'Game PKs'),
      healthBadge(h.trajectoriesOk, 'Trajectories'),
    ].join('');

    const weekStatus = data.weekAligned
      ? '<span class="health-ok">Aligned with ISO week</span>'
      : '<span class="health-warn">ISO week mismatch</span>';

    const gamesTable = (data.games || [])
      .map(
        (g) => `
        <tr>
          <td>${g.index + 1}</td>
          <td>${escapeHtml(g.title)}</td>
          <td><code>${escapeHtml(g.id)}</code></td>
          <td>${g.gamePk ?? '—'}</td>
          <td>~${g.pitchCount ?? 0}</td>
        </tr>`
      )
      .join('');

    challengesReport.innerHTML = `
      <section class="admin-section">
        <h3 class="admin-section__title">Weekly bundle</h3>
        <div class="admin-kpi-row">
          <div class="admin-kpi">
            <span class="admin-kpi__label">Week ID</span>
            <span class="admin-kpi__value">${escapeHtml(data.meta?.challengeWeekId || '—')}</span>
          </div>
          <div class="admin-kpi">
            <span class="admin-kpi__label">Reset</span>
            <span class="admin-kpi__value">${escapeHtml(data.meta?.resetDate || '—')}</span>
          </div>
          <div class="admin-kpi">
            <span class="admin-kpi__label">Games</span>
            <span class="admin-kpi__value">${data.gameCount ?? 0}</span>
          </div>
          <div class="admin-kpi">
            <span class="admin-kpi__label">Pitches</span>
            <span class="admin-kpi__value">~${data.totalPitches ?? 0}</span>
          </div>
          <div class="admin-kpi">
            <span class="admin-kpi__label">Target ABs</span>
            <span class="admin-kpi__value">${data.targetAtBats ?? 200}</span>
          </div>
          <div class="admin-kpi">
            <span class="admin-kpi__label">Bundle size</span>
            <span class="admin-kpi__value">${((data.fileBytes || 0) / 1024).toFixed(0)} KB</span>
          </div>
        </div>
        <p class="admin-meta-line">Current ISO week: <strong>${escapeHtml(data.currentIsoWeek || '—')}</strong> · ${weekStatus}</p>
        <p class="admin-meta-line admin-table__muted">Modified ${formatDate(data.fileModified)}</p>
        <div class="admin-health">${healthHtml}</div>
      </section>
      <section class="admin-section">
        <h3 class="admin-section__title">Games in bundle</h3>
        <div class="admin-table-wrap admin-table-wrap--nested">
          <table class="admin-table admin-table--compact">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Matchup</th>
                <th scope="col">ID</th>
                <th scope="col">MLB PK</th>
                <th scope="col">Pitches</th>
              </tr>
            </thead>
            <tbody>${gamesTable || '<tr><td colspan="5">No games parsed</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    `;
  } catch (err) {
    challengesReport.textContent = err.message || 'Failed to load';
  }
}

document.getElementById('admin-refresh-challenges')?.addEventListener('click', loadChallenges);

checkSession();
