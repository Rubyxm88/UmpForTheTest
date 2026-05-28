export function normalizeHandle(handle) {
  return (handle || '').trim().toUpperCase();
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export function setSessionCookie(res, token) {
  const maxAge = 60 * 60 * 24 * 7;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `ump_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    'ump_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  );
}

export function getSessionToken(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)ump_session=([^;]*)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
