import { readJsonBody, sendJson } from '../../_lib/http.js';
import { verifyAdminCredentials } from '../../_lib/admin-auth.js';
import {
  createAdminSessionToken,
  setAdminSessionCookie,
} from '../../_lib/admin-session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await verifyAdminCredentials(body.username, body.password);
    if (!result.ok) {
      sendJson(res, 401, { error: 'Invalid credentials' });
      return;
    }

    const token = createAdminSessionToken(result.username);
    setAdminSessionCookie(res, token);

    sendJson(res, 200, {
      username: result.username,
      mustChangePassword: Boolean(result.mustChangePassword),
    });
  } catch (err) {
    let msg = err.message || 'Login failed';
    if (/SESSION_SECRET/i.test(msg)) {
      msg =
        'SESSION_SECRET is not set on this deployment. Add a long random string in Vercel → Settings → Environment Variables, then redeploy.';
    }
    sendJson(res, 500, { error: msg });
  }
}
