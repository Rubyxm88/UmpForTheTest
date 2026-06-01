/**
 * Lightweight local API server for Vite dev (port 3000).
 * Mirrors Vercel /api/* routes without requiring `vercel dev`.
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const PORT = Number(process.env.API_PORT) || 3000;

function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

loadEnvFiles();

const hasSupabase =
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  !/your_service_role|placeholder/i.test(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!hasSupabase) {
  console.warn(
    '[dev-api] Supabase not configured — admin Users tab will be empty until .env.local is set.'
  );
}

const handlerCache = new Map();

async function importHandler(file) {
  const mod = await import(`file://${file}`);
  const handler = mod.default;
  if (typeof handler !== 'function') return null;
  return handler;
}

async function resolveRoute(pathname) {
  if (handlerCache.has(pathname)) return handlerCache.get(pathname);

  const rel = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (!rel || rel.includes('..')) return null;

  const segments = rel.split('/');

  // Vercel dynamic route: api/auth/[action].js
  if (segments.length === 2 && segments[0] === 'auth') {
    const file = join(root, 'api', 'auth', '[action].js');
    if (existsSync(file)) {
      const handler = await importHandler(file);
      if (handler) {
        const route = { handler, routeQuery: { action: segments[1] } };
        handlerCache.set(pathname, route);
        return route;
      }
    }
  }

  const file = join(root, 'api', `${rel}.js`);
  if (!existsSync(file)) return null;

  const handler = await importHandler(file);
  if (!handler) return null;

  const route = { handler, routeQuery: {} };
  handlerCache.set(pathname, route);
  return route;
}

function runHandler(route, nodeReq, nodeRes) {
  const url = new URL(nodeReq.url || '/', `http://127.0.0.1:${PORT}`);
  const query = Object.fromEntries(url.searchParams);
  Object.assign(query, route.routeQuery);

  const req = {
    method: nodeReq.method,
    url: nodeReq.url,
    query,
    headers: nodeReq.headers,
    on(event, listener) {
      nodeReq.on(event, listener);
    },
  };

  const res = {
    statusCode: 200,
    setHeader(name, value) {
      nodeRes.setHeader(name, value);
    },
    end(body) {
      nodeRes.statusCode = this.statusCode;
      nodeRes.end(body ?? '');
    },
  };

  return Promise.resolve(route.handler(req, res)).catch((err) => {
    console.error(`[dev-api] ${nodeReq.method} ${nodeReq.url}:`, err);
    if (!nodeRes.headersSent) {
      nodeRes.statusCode = 500;
      nodeRes.setHeader('Content-Type', 'application/json');
      nodeRes.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
    }
  });
}

const server = http.createServer(async (nodeReq, nodeRes) => {
  const url = new URL(nodeReq.url || '/', `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname.replace(/\/$/, '') || '/';

  if (!pathname.startsWith('/api/')) {
    nodeRes.statusCode = 404;
    nodeRes.end('Not found');
    return;
  }

  const route = await resolveRoute(pathname);
  if (!route) {
    nodeRes.statusCode = 404;
    nodeRes.setHeader('Content-Type', 'application/json');
    nodeRes.end(JSON.stringify({ error: 'API route not found' }));
    return;
  }

  await runHandler(route, nodeReq, nodeRes);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-api] http://127.0.0.1:${PORT} (Vite proxies /api here)`);
});
