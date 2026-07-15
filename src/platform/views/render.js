'use strict';

const { marked } = require('marked');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nav(user) {
  const links = [
    `<a href="/">Home</a>`,
    `<a href="/skill">Skill</a>`,
  ];
  if (user) {
    links.splice(1, 0, `<a href="/dashboard">Dashboard</a>`);
    links.push(`<span class="nav-user">▚ ${escapeHtml(user.name)}</span>`);
    links.push(`<a class="btn-ghost" href="/logout">Sign out</a>`);
  } else {
    links.push(`<a class="btn-ghost" href="/login">Sign in</a>`);
  }
  return `<nav class="hud-nav">
    <a class="brand" href="/"><span class="brand-mark">◈</span> HACKATHON<span class="brand-sep">//</span>CONTROL</a>
    <div class="nav-links">${links.join('')}</div>
  </nav>`;
}

function layout({ title, user, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="scanlines" aria-hidden="true"></div>
  ${nav(user)}
  <main class="hud-main">${body}</main>
  <footer class="hud-footer">
    <span>ACA EXPRESS · HACKATHON PLATFORM</span>
    <span class="blink">● SYSTEM ONLINE</span>
  </footer>
</body>
</html>`;
}

function homePage({ user, contentHtml, oidcEnabled }) {
  const cta = user
    ? `<a class="btn-primary" href="/dashboard">Open Dashboard →</a>`
    : oidcEnabled
    ? `<a class="btn-primary" href="/login">Sign in to start →</a>`
    : `<span class="pill warn">Login not configured</span>`;
  const body = `
  <section class="hero panel">
    <div class="panel-head"><span class="dot"></span> MISSION BRIEFING</div>
    <div class="hero-inner">
      <div class="hero-copy markdown">${contentHtml}</div>
      <div class="hero-actions">
        ${cta}
        <a class="btn-ghost" href="/skill">Get the deploy Skill</a>
      </div>
    </div>
  </section>
  <section class="grid-3">
    <div class="panel stat"><div class="panel-head"><span class="dot"></span> DEPLOY</div>
      <p>Ship apps, APIs and static sites to one ACA Express environment — via your AI agent.</p></div>
    <div class="panel stat"><div class="panel-head"><span class="dot"></span> NO AZURE KEYS</div>
      <p>Participants never touch Azure credentials. Sign in, grab a token, let the agent deploy.</p></div>
    <div class="panel stat"><div class="panel-head"><span class="dot"></span> ROLLBACK</div>
      <p>Every iteration is snapshotted. Roll back to any previous version in one click.</p></div>
  </section>`;
  return layout({ title: 'Hackathon Control', user, body });
}

function skillPage({ user, baseUrl }) {
  const body = `
  <section class="panel">
    <div class="panel-head"><span class="dot"></span> AGENT SKILL // aca-hackathon-deploy</div>
    <div class="panel-body markdown">
      <p>Stage this Skill with your AI coding agent so it can deploy on your behalf.
         It targets <code>${escapeHtml(baseUrl)}</code>.</p>
      <ol>
        <li>Download <a href="/skill/SKILL.md" download>SKILL.md</a>.</li>
        <li>Place it where your agent loads skills (e.g. a <code>SKILLS/</code> folder).</li>
        <li>Sign in, copy your <strong>API token</strong> from the Dashboard, and give it to the agent.</li>
        <li>Ask the agent to deploy your app — it will use the platform API.</li>
      </ol>
      <p class="muted">The downloaded file is pre-filled with this platform's URL and endpoints.</p>
      <a class="btn-primary" href="/skill/SKILL.md" download>Download SKILL.md ↓</a>
    </div>
  </section>`;
  return layout({ title: 'Deploy Skill', user, body });
}

function dashboardPage({ user }) {
  const body = `
  <section class="panel" id="identity-panel">
    <div class="panel-head"><span class="dot"></span> OPERATOR // ${escapeHtml(user.name)}</div>
    <div class="panel-body">
      <div class="token-row">
        <div>
          <div class="label">YOUR API TOKEN <span class="muted">(hand this to your agent)</span></div>
          <code id="api-token" class="token">loading…</code>
        </div>
        <button class="btn-ghost" id="copy-token">Copy</button>
      </div>
      <div id="reg-info" class="muted small"></div>
      <div id="prov-warn"></div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <span class="dot"></span> DEPLOY NEW APPLICATION
    </div>
    <div class="panel-body">
      <form id="deploy-form" class="deploy-form">
        <label>Name <input name="name" placeholder="my-demo" required pattern="[A-Za-z0-9\\- ]+" /></label>
        <label>Method
          <select name="method">
            <option value="image">Pre-defined image</option>
            <option value="container">Container (platform registry)</option>
          </select>
        </label>
        <label>Image <input name="image" placeholder="mcr.microsoft.com/azuredocs/containerapps-helloworld:latest" required /></label>
        <label>Size
          <select name="size">
            <option value="1cpu2ram">1 vCPU / 2 GiB</option>
            <option value="2cpu4ram">2 vCPU / 4 GiB</option>
            <option value="4cpu8ram">4 vCPU / 8 GiB</option>
          </select>
        </label>
        <label>Port <input name="targetPort" type="number" value="80" min="1" max="65535" /></label>
        <button class="btn-primary" type="submit">Deploy ►</button>
      </form>
      <div id="deploy-status" class="status-line"></div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <span class="dot"></span> YOUR APPLICATIONS
      <button class="btn-ghost right" id="refresh-apps">↻ Refresh</button>
    </div>
    <div class="panel-body">
      <div id="apps-list" class="apps-list">loading…</div>
    </div>
  </section>

  <div id="detail-modal" class="modal hidden">
    <div class="modal-card panel">
      <div class="panel-head"><span class="dot"></span> <span id="detail-title">APP</span>
        <button class="btn-ghost right" id="close-detail">✕</button></div>
      <div class="panel-body" id="detail-body"></div>
    </div>
  </div>

  <script src="/app.js"></script>`;
  return layout({ title: 'Dashboard', user, body });
}

function markdownToHtml(md) {
  return marked.parse(md || '');
}

module.exports = { layout, homePage, skillPage, dashboardPage, markdownToHtml, escapeHtml };
