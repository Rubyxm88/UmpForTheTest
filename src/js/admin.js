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

const loginScreen = document.getElementById('admin-login-screen');
const passwordScreen = document.getElementById('admin-password-screen');
const panelScreen = document.getElementById('admin-panel-screen');
const loginForm = document.getElementById('admin-login-form');
const passwordForm = document.getElementById('admin-password-form');
const loginError = document.getElementById('admin-login-error');
const passwordError = document.getElementById('admin-password-error');
const signedInAs = document.getElementById('admin-signed-in-as');
const usersList = document.getElementById('admin-users-list');
const userDetail = document.getElementById('admin-user-detail');
const detailJson = document.getElementById('admin-detail-json');
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

function renderUsers(filter = '') {
  if (!usersList) return;
  const q = filter.trim().toUpperCase();
  const rows = allUsers.filter((u) => !q || u.handle.includes(q));
  if (!rows.length) {
    usersList.innerHTML = '<p class="ump-subtitle">No users found</p>';
    return;
  }
  usersList.innerHTML = rows
    .map(
      (u) => `
    <button type="button" class="admin-list__row" data-handle="${u.handle}">
      <span><strong>${u.handle}</strong></span>
      <span class="admin-sub">${u.stats?.xp ?? 0} XP · ${u.favoriteTeam || 'none'}</span>
    </button>`
    )
    .join('');

  usersList.querySelectorAll('[data-handle]').forEach((el) => {
    el.addEventListener('click', () => openUserDetail(el.getAttribute('data-handle')));
  });
}

function renderSupabaseSetupHint(el, hint) {
  if (!el) return;
  el.innerHTML = `
    <div class="admin-setup-hint">
      <p><strong>Database not connected</strong></p>
      <p class="ump-subtitle">${hint || 'Configure Supabase in .env.local and restart the API.'}</p>
      <p class="ump-subtitle">Supabase Dashboard → Project Settings → API → <code>service_role</code> key</p>
    </div>`;
}

async function loadUsers() {
  if (usersList) usersList.textContent = 'Loading…';
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
  if (!userDetail || !detailJson) return;
  userDetail.classList.remove('hidden');
  if (detailHandle) detailHandle.textContent = handle;
  detailJson.textContent = 'Loading…';
  try {
    const data = await api(`/api/admin/user?handle=${encodeURIComponent(handle)}`);
    detailJson.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    detailJson.textContent = err.message;
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

async function loadChallenges() {
  if (!challengesReport) return;
  challengesReport.textContent = 'Loading…';
  try {
    const data = await api('/api/admin/challenges');
    const h = data.health || {};
    const healthHtml = Object.entries(h)
      .map(([k, v]) => {
        const cls = v ? 'health-ok' : 'health-warn';
        return `<div class="${cls}">${k}: ${v ? 'OK' : 'CHECK'}</div>`;
      })
      .join('');

    challengesReport.innerHTML = `
      <p><strong>Week:</strong> ${data.meta?.challengeWeekId || '—'} 
        ${data.weekAligned ? '<span class="health-ok">(matches ISO week)</span>' : '<span class="health-warn">(ISO week mismatch)</span>'}</p>
      <p><strong>Reset:</strong> ${data.meta?.resetDate || '—'} · <strong>Games:</strong> ${data.gameCount} · <strong>Pitches (est):</strong> ${data.totalPitches}</p>
      <p><strong>Target ABs:</strong> ${data.targetAtBats} · <strong>File:</strong> ${(data.fileBytes / 1024).toFixed(0)} KB · modified ${data.fileModified || '—'}</p>
      <div class="admin-health">${healthHtml}</div>
      <ul>${(data.games || [])
        .map(
          (g) =>
            `<li>${g.title} (${g.id}) — ~${g.pitchCount} pitches, PK ${g.gamePk ?? 'n/a'}</li>`
        )
        .join('')}</ul>
    `;
  } catch (err) {
    challengesReport.textContent = err.message || 'Failed to load';
  }
}

document.getElementById('admin-refresh-challenges')?.addEventListener('click', loadChallenges);

checkSession();
