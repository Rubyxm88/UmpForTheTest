import { sendJson } from '../_lib/http.js';
import { handleLogin } from '../_handlers/auth/login.js';
import { handleLogout } from '../_handlers/auth/logout.js';
import { handleMe } from '../_handlers/auth/me.js';
import { handlePin } from '../_handlers/auth/pin.js';
import { handleRegister } from '../_handlers/auth/register.js';

const routes = {
  login: handleLogin,
  logout: handleLogout,
  me: handleMe,
  pin: handlePin,
  register: handleRegister,
};

export default async function handler(req, res) {
  const action = req.query?.action;
  const fn = routes[action];
  if (!fn) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  return fn(req, res);
}
