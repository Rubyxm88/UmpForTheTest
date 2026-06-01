/**
 * Single Vercel function for all /api/admin/* routes.
 */
import { sendJson } from '../_lib/http.js';

const routes = {
  login: () => import('../_handlers/admin/login.js'),
  password: () => import('../_handlers/admin/password.js'),
  me: () => import('../_handlers/admin/me.js'),
  users: () => import('../_handlers/admin/users.js'),
  user: () => import('../_handlers/admin/user.js'),
  challenges: () => import('../_handlers/admin/challenges.js'),
  streak: () => import('../_handlers/admin/streak.js'),
};

export default async function handler(req, res) {
  const raw = req.query?.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const key = segments[0] || '';

  const load = routes[key];
  if (!load) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const mod = await load();
  return mod.default(req, res);
}
