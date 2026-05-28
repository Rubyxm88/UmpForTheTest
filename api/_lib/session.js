import crypto from 'node:crypto';
import { normalizeHandle, getSessionToken } from './http.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured');
  }
  return secret;
}

export function createSessionToken(handle) {
  const normalized = normalizeHandle(handle);
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${normalized}:${exp}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

export function verifySessionToken(token) {
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

  const [handle, expStr] = payload.split(':');
  const exp = Number(expStr);
  if (!handle || !Number.isFinite(exp) || Date.now() > exp) return null;
  return handle;
}

export function getHandleFromRequest(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  return verifySessionToken(token);
}
