import { sendJson } from '../_lib/http.js';
import { getAdminFromRequest } from '../_lib/admin-session.js';
import { getDevAdminAccount } from '../_lib/admin-auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const admin = getAdminFromRequest(req);
  if (!admin) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  const devRow = getDevAdminAccount(admin);
  if (devRow) {
    sendJson(res, 200, {
      username: admin,
      mustChangePassword: Boolean(devRow.must_change_password),
    });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('admin_accounts')
      .select('must_change_password')
      .eq('username', admin)
      .maybeSingle();

    sendJson(res, 200, {
      username: admin,
      mustChangePassword: Boolean(data?.must_change_password),
    });
  } catch {
    sendJson(res, 200, { username: admin, mustChangePassword: false });
  }
}
