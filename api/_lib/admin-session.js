import crypto from 'node:crypto';
import { getSessionToken } from './http.js';

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  const isProd =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  if (!isProd) {
    return 'dev-only-admin-session-secret-not-for-production';
  }
  throw new Error('SESSION_SECRET is not configured');
}

export function createAdminSessionToken(username) {
  const user = (username || '').trim().toLowerCase();
  const exp = Date.now() + ADMIN_SESSION_TTL_MS;
  const payload = `admin:${user}:${exp}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

export function verifyAdminSessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  let payload;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  if (sig !== expected) return null;

  const parts = payload.split(':');
  if (parts[0] !== 'admin' || parts.length < 3) return null;
  const username = parts[1];
  const exp = Number(parts[2]);
  if (!username || !Number.isFinite(exp) || Date.now() > exp) return null;
  return username;
}

export function getAdminFromRequest(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)ump_admin_session=([^;]*)/);
  if (!match) return null;
  try {
    return verifyAdminSessionToken(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function setAdminSessionCookie(res, token) {
  const maxAge = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `ump_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

export function clearAdminSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    'ump_admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  );
}
