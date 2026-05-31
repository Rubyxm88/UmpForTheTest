import { readJsonBody, sendJson } from '../_lib/http.js';
import { getAdminFromRequest } from '../_lib/admin-session.js';
import {
  verifyAdminCredentials,
  upsertAdminPassword,
  isValidAdminPassword,
} from '../_lib/admin-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const admin = getAdminFromRequest(req);
  if (!admin) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const newPassword = String(body.newPassword || '');
    const currentPassword = String(body.currentPassword || '');

    if (!isValidAdminPassword(newPassword)) {
      sendJson(res, 400, { error: 'New password must be 6–64 characters' });
      return;
    }

    const check = await verifyAdminCredentials(admin, currentPassword);
    if (!check.ok) {
      sendJson(res, 401, { error: 'Current password is incorrect' });
      return;
    }

    await upsertAdminPassword(admin, newPassword);
    sendJson(res, 200, { ok: true, mustChangePassword: false });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Password update failed' });
  }
}
