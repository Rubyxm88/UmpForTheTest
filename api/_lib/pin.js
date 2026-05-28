import crypto from 'node:crypto';

export function hashPIN(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

export function isValidPin(pin) {
  return /^\d{4,8}$/.test(String(pin || ''));
}

export function isValidHandle(handle) {
  return normalizeHandle(handle).length >= 3;
}

function normalizeHandle(handle) {
  return (handle || '').trim().toUpperCase();
}
