'use strict';

const { Issuer, generators } = require('openid-client');
const config = require('./config');

let clientPromise = null;

// Discover the Keycloak realm and build a confidential OIDC client once.
async function getClient() {
  if (!config.oidcEnabled) {
    throw new Error('OIDC is not configured (OIDC_ISSUER / OIDC_CLIENT_ID missing).');
  }
  if (!clientPromise) {
    clientPromise = Issuer.discover(config.oidc.issuer)
      .then(
        (issuer) =>
          new issuer.Client({
            client_id: config.oidc.clientId,
            client_secret: config.oidc.clientSecret,
            redirect_uris: [config.oidc.redirectUri],
            response_types: ['code'],
          })
      )
      .catch((err) => {
        clientPromise = null; // allow retry on transient discovery failures
        throw err;
      });
  }
  return clientPromise;
}

// Begin the Authorization Code + PKCE flow; stash the transaction in the session.
async function beginLogin(req, res) {
  const client = await getClient();
  const codeVerifier = generators.codeVerifier();
  const state = generators.state();
  const nonce = generators.nonce();
  req.session.oidc = { codeVerifier, state, nonce };

  const url = client.authorizationUrl({
    scope: 'openid profile email',
    code_challenge: generators.codeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  res.redirect(url);
}

// Complete the flow: validate params, exchange the code, populate the session user.
async function completeLogin(req) {
  const client = await getClient();
  const tx = (req.session && req.session.oidc) || {};
  const params = client.callbackParams(req);
  const tokenSet = await client.callback(config.oidc.redirectUri, params, {
    code_verifier: tx.codeVerifier,
    state: tx.state,
    nonce: tx.nonce,
  });
  const claims = tokenSet.claims();
  const user = {
    id: claims.preferred_username || claims.email || claims.sub,
    name: claims.name || claims.preferred_username || claims.email || claims.sub,
    email: claims.email || '',
  };
  req.session.oidc = undefined;
  req.session.user = user;
  // Keep the raw id_token so it can be sent as id_token_hint on logout (required by
  // Keycloak 18+ RP-initiated logout when a post_logout_redirect_uri is supplied).
  req.session.idToken = tokenSet.id_token;
  return user;
}

// Build the end-session (logout) URL if the provider supports it. Keycloak rejects the
// end_session_endpoint with "Missing parameters: id_token_hint" unless an id_token_hint
// (or client_id) accompanies the post_logout_redirect_uri, so pass both when available.
async function endSessionUrl(idTokenHint) {
  try {
    const client = await getClient();
    if (client.issuer.metadata.end_session_endpoint) {
      const params = {
        post_logout_redirect_uri: config.baseUrl,
        client_id: config.oidc.clientId,
      };
      if (idTokenHint) params.id_token_hint = idTokenHint;
      return client.endSessionUrl(params);
    }
  } catch (_) {
    /* fall through */
  }
  return config.baseUrl;
}

module.exports = { getClient, beginLogin, completeLogin, endSessionUrl };
