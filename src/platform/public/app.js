'use strict';

// Dashboard client. Talks to the same-origin /api using the browser session cookie.
const $ = (sel) => document.querySelector(sel);
const api = async (method, path, body) => {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
};

let ME = null;

function badge(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('running') || s.includes('succeeded')) return '<span class="badge run">running</span>';
  if (s.includes('provision') || s.includes('progress') || s.includes('waiting')) return '<span class="badge prov">deploying</span>';
  if (s.includes('fail') || s.includes('error')) return '<span class="badge fail">failed</span>';
  return `<span class="badge">${escapeHtml(status || 'unknown')}</span>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

async function loadMe() {
  ME = await api('GET', '/me');
  $('#api-token').textContent = ME.apiToken || '(sign in via browser to mint a token)';
  if (ME.registryLoginServer) {
    $('#reg-info').innerHTML =
      `Platform registry: <code>${escapeHtml(ME.registryLoginServer)}</code> — push here for <code>container</code> deploys.`;
  }
  if (!ME.provisioningEnabled) {
    $('#prov-warn').innerHTML =
      `<div class="status-line err">⚠ Provisioning is disabled — the operator has not configured a service principal. Deployments will fail until then.</div>`;
  }
}

async function loadApps() {
  const list = $('#apps-list');
  list.textContent = 'loading…';
  try {
    const { apps } = await api('GET', '/apps');
    if (!apps.length) {
      list.innerHTML = '<p class="muted">No applications yet. Deploy one above, or ask your agent to.</p>';
      return;
    }
    list.innerHTML = apps.map(appCard).join('');
    apps.forEach((a) => {
      $(`#detail-${cssId(a.name)}`).addEventListener('click', () => openDetail(a.name, a.friendlyName));
      const del = $(`#del-${cssId(a.name)}`);
      if (del) del.addEventListener('click', () => deleteApp(a.name));
    });
  } catch (e) {
    list.innerHTML = `<div class="status-line err">${escapeHtml(e.message)}</div>`;
  }
}

function cssId(name) {
  return String(name).replace(/[^a-z0-9]/gi, '_');
}

function appCard(a) {
  const url = a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.url)}</a>` : '<span class="muted">no url yet</span>';
  return `<div class="app-card">
    <div>
      <div class="app-name">${escapeHtml(a.friendlyName)} ${badge(a.status)}</div>
      <div class="app-meta">${url}</div>
      <div class="app-meta">${escapeHtml(a.size || '')} · ${escapeHtml(a.image || '')}</div>
    </div>
    <div class="app-actions">
      <button class="btn-ghost" id="detail-${cssId(a.name)}">Versions</button>
      <button class="btn-ghost" id="del-${cssId(a.name)}">Delete</button>
    </div>
  </div>`;
}

async function openDetail(name, friendly) {
  const modal = $('#detail-modal');
  $('#detail-title').textContent = friendly || name;
  $('#detail-body').innerHTML = 'loading snapshots…';
  modal.classList.remove('hidden');
  try {
    const { snapshots } = await api('GET', `/apps/${encodeURIComponent(name)}/snapshots`);
    if (!snapshots.length) {
      $('#detail-body').innerHTML = '<p class="muted">No snapshots recorded yet.</p>';
      return;
    }
    const rows = snapshots
      .map(
        (s) => `<tr class="${s.active ? 'active-row' : ''}">
        <td>${s.active ? '● ' : ''}${escapeHtml(s.revision)}</td>
        <td>${escapeHtml((s.image || '').split('/').pop())}</td>
        <td>${s.createdTime ? new Date(s.createdTime).toLocaleString() : '—'}</td>
        <td>${escapeHtml(s.provisioningState || '')}</td>
        <td>${s.active ? '<span class="muted">current</span>' : `<button class="btn-ghost" data-rev="${escapeHtml(s.revision)}">Roll back</button>`}</td>
      </tr>`
      )
      .join('');
    $('#detail-body').innerHTML =
      `<table class="snap-table"><thead><tr><th>Revision</th><th>Image</th><th>Created</th><th>State</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    $('#detail-body')
      .querySelectorAll('button[data-rev]')
      .forEach((btn) =>
        btn.addEventListener('click', () => rollback(name, btn.getAttribute('data-rev')))
      );
  } catch (e) {
    $('#detail-body').innerHTML = `<div class="status-line err">${escapeHtml(e.message)}</div>`;
  }
}

async function rollback(name, revision) {
  if (!confirm(`Roll back "${name}" to ${revision}?`)) return;
  $('#detail-body').innerHTML = 'rolling back…';
  try {
    await api('POST', `/apps/${encodeURIComponent(name)}/rollback`, { revision });
    $('#detail-modal').classList.add('hidden');
    await loadApps();
  } catch (e) {
    $('#detail-body').innerHTML = `<div class="status-line err">${escapeHtml(e.message)}</div>`;
  }
}

async function deleteApp(name) {
  if (!confirm(`Delete application "${name}"? This cannot be undone.`)) return;
  try {
    await api('DELETE', `/apps/${encodeURIComponent(name)}`);
    await loadApps();
  } catch (e) {
    alert(e.message);
  }
}

function initForm() {
  $('#deploy-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const status = $('#deploy-status');
    status.className = 'status-line work';
    status.textContent = '► deploying… (this can take 1–2 minutes)';
    const payload = {
      name: f.name.value.trim(),
      method: f.method.value,
      image: f.image.value.trim(),
      size: f.size.value,
      targetPort: parseInt(f.targetPort.value, 10) || 80,
    };
    try {
      const { app } = await api('POST', '/apps', payload);
      status.className = 'status-line ok';
      status.innerHTML = app.url
        ? `✔ deployed: <a href="${escapeHtml(app.url)}" target="_blank" rel="noopener">${escapeHtml(app.url)}</a>`
        : '✔ deployed.';
      f.reset();
      await loadApps();
    } catch (e) {
      status.className = 'status-line err';
      status.textContent = '✖ ' + e.message;
    }
  });
}

$('#copy-token').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#api-token').textContent);
    $('#copy-token').textContent = 'Copied';
    setTimeout(() => ($('#copy-token').textContent = 'Copy'), 1500);
  } catch (_) {}
});
$('#refresh-apps').addEventListener('click', loadApps);
$('#close-detail').addEventListener('click', () => $('#detail-modal').classList.add('hidden'));

initForm();
loadMe().catch((e) => ($('#api-token').textContent = 'error: ' + e.message));
loadApps();
