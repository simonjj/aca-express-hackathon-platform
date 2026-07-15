'use strict';

const config = require('./config');
const { verifyApiToken } = require('./tokens');

function isAdmin(user) {
  if (!user) return false;
  const name = String(user.id || '').toLowerCase();
  const email = String(user.email || '').toLowerCase();
  return config.adminUsers.includes(name) || config.adminUsers.includes(email);
}

function getSessionUser(req) {
  return (req.session && req.session.user) || null;
}

// EasyAuth (ACA sidecar) injects the authenticated principal as a base64-encoded JSON
// blob in X-MS-CLIENT-PRINCIPAL, plus X-MS-CLIENT-PRINCIPAL-NAME. Parse it into the same
// shape as the OIDC/session user ({ id, name, email }).
function getEasyAuthUser(req) {
  const raw = req.headers['x-ms-client-principal'];
  const headerName = req.headers['x-ms-client-principal-name'];
  if (!raw && !headerName) return null;

  const claims = {};
  if (raw) {
    try {
      const principal = JSON.parse(Buffer.from(String(raw), 'base64').toString('utf8'));
      const list = principal.claims || principal.Claims || [];
      for (const c of list) {
        const typ = c.typ || c.Typ;
        const val = c.val != null ? c.val : c.Val;
        if (typ && val != null && claims[typ] === undefined) claims[typ] = val;
      }
    } catch (_) {
      /* fall back to the name header below */
    }
  }

  const pick = (...keys) => keys.map((k) => claims[k]).find((v) => v != null);
  const preferred = pick('preferred_username');
  const email = pick('email', 'emails', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress');
  const name = pick('name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name');
  const sub = pick('sub', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier');

  const id = preferred || email || headerName || sub;
  if (!id) return null;
  return { id, name: name || preferred || email || headerName || id, email: email || '' };
}

// The current request's user, regardless of auth mechanism: EasyAuth headers first (when
// the sidecar is enabled), then a browser session (OIDC app-level flow / API cookie).
function getCurrentUser(req) {
  if (config.easyAuthEnabled) {
    const u = getEasyAuthUser(req);
    if (u) return u;
  }
  return getSessionUser(req);
}

// Page guard: browser routes. Redirect to login when there is no session.
function requirePage(req, res, next) {
  const user = getCurrentUser(req);
  if (user) {
    req.user = user;
    return next();
  }
  return res.redirect('/login');
}

// API guard: accept either a browser session cookie OR a Bearer API token (agents).
function requireApi(req, res, next) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    try {
      req.user = verifyApiToken(auth.slice(7).trim());
      req.authKind = 'token';
      return next();
    } catch (e) {
      return res.status(401).json({ error: 'invalid_token', message: 'API token is invalid or expired.' });
    }
  }
  const user = getCurrentUser(req);
  if (user) {
    req.user = user;
    req.authKind = 'session';
    return next();
  }
  return res
    .status(401)
    .json({ error: 'unauthorized', message: 'Provide an Authorization: Bearer <token> header or sign in.' });
}

module.exports = { isAdmin, getSessionUser, getEasyAuthUser, getCurrentUser, requirePage, requireApi };
