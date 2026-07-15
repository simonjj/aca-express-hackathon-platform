'use strict';

const jwt = require('jsonwebtoken');
const config = require('./config');

const ISSUER = 'aca-hackathon-platform';

// Per-user API token used by AI agents (via the SKILL) to call the deployment API.
// Signed with PLATFORM_API_SECRET; long-lived for the duration of a hackathon.
function mintApiToken(user, expiresIn = '30d') {
  return jwt.sign(
    { sub: user.id, name: user.name || user.id, email: user.email || '' },
    config.apiSecret,
    { expiresIn, issuer: ISSUER }
  );
}

function verifyApiToken(token) {
  const claims = jwt.verify(token, config.apiSecret, { issuer: ISSUER });
  return { id: claims.sub, name: claims.name, email: claims.email };
}

module.exports = { mintApiToken, verifyApiToken };
