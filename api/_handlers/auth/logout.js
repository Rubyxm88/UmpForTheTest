import { clearSessionCookie, sendJson } from '../../_lib/http.js';

export async function handleLogout(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}
