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

// Page guard: browser routes. Redirect to login when there is no session.
function requirePage(req, res, next) {
  const user = getSessionUser(req);
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
  const user = getSessionUser(req);
  if (user) {
    req.user = user;
    req.authKind = 'session';
    return next();
  }
  return res
    .status(401)
    .json({ error: 'unauthorized', message: 'Provide an Authorization: Bearer <token> header or sign in.' });
}

module.exports = { isAdmin, getSessionUser, requirePage, requireApi };
