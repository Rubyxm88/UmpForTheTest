import { hashPIN, isValidPin } from '../../_lib/pin.js';
import { getHandleFromRequest } from '../../_lib/session.js';
import { readJsonBody, sendJson } from '../../_lib/http.js';
import { getSupabaseAdmin } from '../../_lib/supabase.js';

export async function handlePin(req, res) {
  if (req.method !== 'PUT') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const handle = getHandleFromRequest(req);
  if (!handle) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const pin = String(body.pin || '');
    if (!isValidPin(pin)) {
      sendJson(res, 400, { error: 'PIN must be 4 to 8 digits' });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('profiles')
      .update({ pin_hash: hashPIN(pin) })
      .eq('handle', handle);

    if (error) {
      sendJson(res, 500, { error: error.message });
      return;
    }

    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Failed to update PIN' });
  }
}
