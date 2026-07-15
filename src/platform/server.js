'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieSession = require('cookie-session');

const config = require('./lib/config');
const oidc = require('./lib/oidc');
const { renderSkill } = require('./lib/skill');
const { requirePage, getCurrentUser } = require('./lib/auth');
const { homePage, skillPage, dashboardPage, markdownToHtml, layout } = require('./views/render');
const apiRouter = require('./routes/api');

const app = express();
app.set('trust proxy', true); // behind the ACA ingress / auth proxy
app.disable('x-powered-by');

app.use(express.json({ limit: '256kb' }));
app.use(
  cookieSession({
    name: 'hksess',
    keys: [config.sessionSecret],
    httpOnly: true,
    sameSite: 'lax',
    secure: config.baseUrl.startsWith('https://'),
    maxAge: 8 * 60 * 60 * 1000,
  })
);

app.use(express.static(path.join(__dirname, 'public')));

// --- Health (public, unauthenticated) --------------------------------------
app.get(['/healthz', '/health'], (_req, res) => res.status(200).send('ok'));

// --- Public homepage (markdown-driven) -------------------------------------
function loadHomepageMarkdown() {
  if (config.homepageMarkdown) return config.homepageMarkdown;
  try {
    return fs.readFileSync(path.join(__dirname, 'content', 'homepage.md'), 'utf8');
  } catch (_) {
    return '# Welcome to the Hackathon\n\nAsk your organizer to configure the homepage.';
  }
}

app.get('/', (req, res) => {
  const user = getCurrentUser(req);
  res.type('html').send(
    homePage({
      user,
      contentHtml: markdownToHtml(loadHomepageMarkdown()),
      oidcEnabled: config.loginEnabled,
    })
  );
});

// --- Auth ------------------------------------------------------------------
// EasyAuth stores its session in the `AppServiceAuthSession` cookie (chunked into
// `AppServiceAuthSession0..n` when large). Expire all of them (host-only, path=/) so the
// browser drops the EasyAuth session on logout without contacting Keycloak.
function clearEasyAuthSession(res) {
  const names = ['AppServiceAuthSession'];
  for (let i = 0; i < 5; i += 1) names.push(`AppServiceAuthSession${i}`);
  const secure = config.baseUrl.startsWith('https://');
  const cookies = names.map(
    (n) =>
      `${n}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax${
        secure ? '; Secure' : ''
      }`
  );
  res.append('Set-Cookie', cookies);
}

// EasyAuth mode: the ACA sidecar owns the OIDC flow; /login and /logout just bounce to
// the platform's /.auth endpoints. OIDC mode: the app runs the Authorization Code + PKCE
// flow itself (lib/oidc.js). Either way the browser lands back on /dashboard.
app.get('/login', async (req, res) => {
  if (getCurrentUser(req)) return res.redirect('/dashboard');
  if (!config.loginEnabled) {
    return res
      .status(503)
      .type('html')
      .send(layout({ title: 'Login unavailable', user: null, body: authNotConfigured() }));
  }
  if (config.easyAuthEnabled) {
    const provider = encodeURIComponent(config.oidc.providerName);
    return res.redirect(`/.auth/login/${provider}?post_login_redirect_uri=%2Fdashboard`);
  }
  try {
    await oidc.beginLogin(req, res);
  } catch (err) {
    console.error('[login]', err);
    res.status(500).type('html').send(layout({ title: 'Login error', user: null, body: errorPanel(err) }));
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    await oidc.completeLogin(req);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('[callback]', err);
    res.status(401).type('html').send(layout({ title: 'Login failed', user: null, body: errorPanel(err) }));
  }
});

app.get('/logout', async (req, res) => {
  const idTokenHint = req.session && req.session.idToken;
  req.session = null;
  if (config.easyAuthEnabled) {
    // Local logout: clear the EasyAuth session cookie ourselves and return to the app.
    // We deliberately do NOT redirect to /.auth/logout: for a custom OIDC provider it
    // performs a federated sign-out to Keycloak's end_session_endpoint without an
    // id_token_hint, which Keycloak 18+ rejects ("Missing parameters: id_token_hint").
    // EasyAuth remains the frontend; Keycloak stays a backend-only IdP. The user's
    // Keycloak SSO cookie is left intact, so a subsequent login is silent.
    clearEasyAuthSession(res);
    return res.redirect('/');
  }
  let url = config.baseUrl;
  try {
    url = await oidc.endSessionUrl(idTokenHint);
  } catch (_) {
    /* ignore */
  }
  res.redirect(url);
});

// --- Dashboard (authenticated shell; data via /api) ------------------------
app.get('/dashboard', requirePage, (req, res) => {
  res.type('html').send(dashboardPage({ user: req.user }));
});

// --- Skill staging ---------------------------------------------------------
app.get('/skill', (req, res) => {
  res.type('html').send(skillPage({ user: getCurrentUser(req), baseUrl: config.baseUrl }));
});

app.get('/skill/SKILL.md', (_req, res) => {
  res
    .type('text/markdown; charset=utf-8')
    .set('Content-Disposition', 'attachment; filename="SKILL.md"')
    .send(renderSkill(config.baseUrl, config.defaultReplicaSize));
});

// --- API -------------------------------------------------------------------
app.use('/api', apiRouter);

// --- Helpers ---------------------------------------------------------------
function authNotConfigured() {
  return `<section class="panel"><div class="panel-head"><span class="dot"></span> LOGIN UNAVAILABLE</div>
    <div class="panel-body"><p>OIDC login is not configured on this deployment
    (missing <code>OIDC_ISSUER</code>). The homepage and Skill are still available.</p></div></section>`;
}
function errorPanel(err) {
  return `<section class="panel"><div class="panel-head"><span class="dot"></span> ERROR</div>
    <div class="panel-body"><p>${String(err.message || err).replace(/</g, '&lt;')}</p>
    <a class="btn-ghost" href="/">← Back</a></div></section>`;
}

app.listen(config.port, () => {
  console.log(`Hackathon platform listening on :${config.port}`);
  console.log(`  baseUrl              = ${config.baseUrl}`);
  console.log(`  loginEnabled         = ${config.loginEnabled} (easyAuth=${config.easyAuthEnabled}, oidc=${config.oidcEnabled})`);
  console.log(`  provisioning         = ${config.provisioningEnabled} (${config.provisioningMode})`);
});
