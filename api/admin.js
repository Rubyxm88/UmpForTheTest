/**
 * Single serverless function for all /api/admin/* routes.
 * Vercel rewrites /api/admin/:path* → /api/admin?route=:path*
 */
import { sendJson } from './_lib/http.js';

const routes = {
  login: () => import('./_handlers/admin/login.js'),
  password: () => import('./_handlers/admin/password.js'),
  me: () => import('./_handlers/admin/me.js'),
  users: () => import('./_handlers/admin/users.js'),
  user: () => import('./_handlers/admin/user.js'),
  challenges: () => import('./_handlers/admin/challenges.js'),
  streak: () => import('./_handlers/admin/streak.js'),
};

function resolveRouteKey(req) {
  const fromQuery = req.query?.route ?? req.query?.path;
  if (fromQuery != null && fromQuery !== '') {
    const first = Array.isArray(fromQuery) ? fromQuery[0] : String(fromQuery).split('/')[0];
    if (first) return first;
  }

  try {
    const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost';
    const proto = req.headers?.['x-forwarded-proto'] || 'http';
    const pathname = new URL(req.url || '/', `${proto}://${host}`).pathname;
    const match = pathname.match(/\/api\/admin\/([^/?#]+)/);
    if (match) return decodeURIComponent(match[1]);
  } catch {
    /* ignore */
  }

  return '';
}

export default async function handler(req, res) {
  const key = resolveRouteKey(req);
  const load = routes[key];
  if (!load) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const mod = await load();
  return mod.default(req, res);
}
