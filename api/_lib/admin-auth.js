import { hashPIN } from './pin.js';
import { tryGetSupabaseAdmin } from './supabase.js';

const DEFAULT_USER = 'admin';
const DEFAULT_PASS = 'admin';

/** In-memory admin creds when Supabase env is missing (local dev only). */
const devAdminAccounts = new Map();

function isProduction() {
  return (
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  );
}

export function getDevAdminAccount(username) {
  return devAdminAccounts.get((username || '').trim().toLowerCase()) || null;
}

export async function verifyAdminCredentials(username, password) {
  const user = (username || '').trim().toLowerCase();
  const pass = String(password || '');
  if (!user || !pass) return { ok: false };

  const devRow = getDevAdminAccount(user);
  if (devRow?.password_hash) {
    return {
      ok: devRow.password_hash === hashPIN(pass),
      username: user,
      mustChangePassword: Boolean(devRow.must_change_password),
    };
  }

  const supabase = tryGetSupabaseAdmin();
  if (supabase) try {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('username, password_hash, must_change_password')
      .eq('username', user)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.warn('admin_accounts lookup:', error.message);
    }

    if (data?.password_hash) {
      return {
        ok: data.password_hash === hashPIN(pass),
        username: data.username,
        mustChangePassword: Boolean(data.must_change_password),
      };
    }

    const { count } = await supabase
      .from('admin_accounts')
      .select('*', { count: 'exact', head: true });

    const tableEmpty = !count;
    const envUser = (process.env.ADMIN_USERNAME || DEFAULT_USER).toLowerCase();
    const envHash =
      process.env.ADMIN_PASSWORD_HASH ||
      hashPIN(process.env.ADMIN_PASSWORD || DEFAULT_PASS);

    if (tableEmpty && user === envUser && hashPIN(pass) === envHash) {
      return {
        ok: true,
        username: user,
        mustChangePassword: !process.env.ADMIN_PASSWORD_HASH,
        bootstrap: true,
      };
    }
  } catch (err) {
    console.warn('Admin auth Supabase error:', err.message);
  }

  const envUser = (process.env.ADMIN_USERNAME || DEFAULT_USER).toLowerCase();
  const envHash =
    process.env.ADMIN_PASSWORD_HASH ||
    hashPIN(process.env.ADMIN_PASSWORD || DEFAULT_PASS);
  if (user === envUser && hashPIN(pass) === envHash) {
    return {
      ok: true,
      username: user,
      mustChangePassword: !process.env.ADMIN_PASSWORD_HASH,
      bootstrap: true,
    };
  }

  return { ok: false };
}

export async function upsertAdminPassword(username, newPassword) {
  const user = (username || '').trim().toLowerCase();
  const row = {
    username: user,
    password_hash: hashPIN(newPassword),
    must_change_password: false,
    updated_at: new Date().toISOString(),
  };

  const supabase = tryGetSupabaseAdmin();
  if (supabase) try {
    const { error } = await supabase.from('admin_accounts').upsert(row, {
      onConflict: 'username',
    });
    if (error) throw error;
    devAdminAccounts.set(user, row);
    return;
  } catch (err) {
    console.warn('admin password Supabase error:', err.message);
  }

  if (isProduction() && !supabase) {
    throw new Error(
      'Cannot save admin password without Supabase. Set SUPABASE_SERVICE_ROLE_KEY on Vercel (service_role from Supabase dashboard for UmpSim3000), then redeploy. See docs/SUPABASE_SETUP.md.'
    );
  }
  devAdminAccounts.set(user, row);
}

export function isValidAdminPassword(password) {
  const p = String(password || '');
  return p.length >= 6 && p.length <= 64;
}
