'use strict';

const crypto = require('crypto');
const { ContainerAppsAPIClient } = require('@azure/arm-appcontainers');
const { ClientSecretCredential, ManagedIdentityCredential } = require('@azure/identity');
const config = require('./config');
const { normalizeSize, resourcesFor } = require('./sizes');

// NOTE: @azure/arm-appcontainers uses FLATTENED models — ContainerApp/Revision fields
// (configuration, template, managedEnvironmentId, active, ...) live at the top level,
// NOT under a `.properties` object. Inputs are flattened the same way.

const PLATFORM_TAG = 'hackathon-platform';
const OWNER_TAG = 'hackathon-owner';
const OWNER_NAME_TAG = 'hackathon-owner-name';
const APP_NAME_TAG = 'hackathon-app-name';
const METHOD_TAG = 'hackathon-method';
const SIZE_TAG = 'hackathon-size';

let _client = null;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function ensureProvisioning() {
  if (!config.provisioningEnabled) {
    throw new ApiError(
      503,
      'Provisioning is disabled: no managed identity or service principal configured. ' +
        'Deploy with useManagedIdentityProvisioning=true, or set AZURE_PROVISION_* (see scripts/create-provisioner-sp).'
    );
  }
}

// The control plane runs on a standard ACA env, so it can authenticate to ARM with a
// user-assigned managed identity (default). A service principal client secret is used
// instead when one is configured (takes precedence). The target participant apps still
// land on the Express env — that env's lack of MI does not affect this caller identity.
function buildCredential() {
  if (config.provisioningMode === 'service-principal') {
    return new ClientSecretCredential(
      config.azure.tenantId,
      config.azure.clientId,
      config.azure.clientSecret
    );
  }
  return new ManagedIdentityCredential({ clientId: config.azure.managedIdentityClientId || undefined });
}

function getClient() {
  ensureProvisioning();
  if (!_client) {
    _client = new ContainerAppsAPIClient(buildCredential(), config.azure.subscriptionId);
  }
  return _client;
}

function ownerHash(ownerId) {
  return crypto.createHash('sha256').update(String(ownerId)).digest('hex').slice(0, 6);
}

// ACA app names: 2-32 chars, lowercase alphanumeric + '-', start/end alphanumeric.
function buildResourceName(ownerId, friendly) {
  const san = String(friendly || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  let name = `h${ownerHash(ownerId)}-${san || 'app'}`.slice(0, 32).replace(/-+$/g, '');
  if (name.length < 2) name = `h${ownerHash(ownerId)}`;
  return name;
}

function registriesAndSecretsForImage(image) {
  if (config.acr.loginServer && image.startsWith(config.acr.loginServer + '/')) {
    return {
      registries: [
        { server: config.acr.loginServer, username: config.acr.username, passwordSecretRef: 'reg-pw' },
      ],
      secrets: [{ name: 'reg-pw', value: config.acr.password }],
    };
  }
  return { registries: [], secrets: [] };
}

function appUrl(app) {
  const fqdn = app.configuration && app.configuration.ingress && app.configuration.ingress.fqdn;
  return fqdn ? `https://${fqdn}` : null;
}

function toSummary(app) {
  const tags = app.tags || {};
  const container = (app.template && app.template.containers && app.template.containers[0]) || {};
  return {
    name: app.name,
    friendlyName: tags[APP_NAME_TAG] || app.name,
    owner: tags[OWNER_TAG] || null,
    ownerName: tags[OWNER_NAME_TAG] || null,
    method: tags[METHOD_TAG] || null,
    size: tags[SIZE_TAG] || null,
    image: container.image || null,
    url: appUrl(app),
    status: app.runningStatus || app.provisioningState || 'Unknown',
    provisioningState: app.provisioningState || null,
    latestRevision: app.latestRevisionName || null,
    createdTime: app.systemData && app.systemData.createdAt ? app.systemData.createdAt : null,
    location: app.location || null,
  };
}

function assertOwner(app, user, isAdmin) {
  const owner = (app.tags || {})[OWNER_TAG];
  if (!owner) throw new ApiError(404, 'Application not found.');
  if (owner !== user.id && !isAdmin) throw new ApiError(403, 'You do not own this application.');
}

async function fetchOwned(client, user, name, isAdmin) {
  let app;
  try {
    app = await client.containerApps.get(config.azure.resourceGroup, name);
  } catch (e) {
    throw new ApiError(404, 'Application not found.');
  }
  assertOwner(app, user, isAdmin);
  return app;
}

// --- Public operations -----------------------------------------------------

async function createApp(user, { name, method, image, size, targetPort, external, env }) {
  const client = getClient();

  if (!name) throw new ApiError(400, 'A "name" is required.');
  const methodNorm = (method || 'image').toLowerCase();
  if (!['image', 'container'].includes(methodNorm)) {
    throw new ApiError(400, 'method must be "image" (pre-defined image) or "container".');
  }
  if (!image) throw new ApiError(400, 'An "image" reference is required.');

  const sizeKey = normalizeSize(size, config.defaultReplicaSize);
  if (!sizeKey) throw new ApiError(400, 'size must be one of 1cpu2ram, 2cpu4ram, 4cpu8ram.');

  const resourceName = buildResourceName(user.id, name);
  const port = parseInt(targetPort, 10) || 80;
  const { registries, secrets } = registriesAndSecretsForImage(image);
  const containerEnv = Object.entries(env || {}).map(([k, v]) => ({ name: k, value: String(v) }));

  const envelope = {
    location: config.azure.location,
    tags: {
      [PLATFORM_TAG]: 'true',
      [OWNER_TAG]: user.id,
      [OWNER_NAME_TAG]: (user.name || user.id).slice(0, 240),
      [APP_NAME_TAG]: String(name).slice(0, 240),
      [METHOD_TAG]: methodNorm,
      [SIZE_TAG]: sizeKey,
    },
    managedEnvironmentId: config.azure.managedEnvironmentId,
    configuration: {
      activeRevisionsMode: 'Single',
      ingress: {
        external: external !== false, // Express is public-only anyway
        targetPort: port,
        transport: 'auto',
        allowInsecure: false,
      },
      registries,
      secrets,
    },
    template: {
      // NOTE: Express environments reject a custom template.revisionSuffix
      // (ExpressEnvironmentFeatureNotSupported). ACA auto-names each revision from the
      // template, so every deploy still produces a new revision = a snapshot.
      containers: [
        {
          name: 'main',
          image,
          resources: resourcesFor(sizeKey),
          env: containerEnv,
        },
      ],
      scale: { minReplicas: 0, maxReplicas: 2 },
    },
  };

  const app = await client.containerApps.beginCreateOrUpdateAndWait(
    config.azure.resourceGroup,
    resourceName,
    envelope
  );
  return toSummary(app);
}

async function listApps(user, isAdmin) {
  const client = getClient();
  const out = [];
  for await (const app of client.containerApps.listByResourceGroup(config.azure.resourceGroup)) {
    const tags = app.tags || {};
    if (tags[PLATFORM_TAG] !== 'true' || !tags[OWNER_TAG]) continue;
    if (!isAdmin && tags[OWNER_TAG] !== user.id) continue;
    out.push(toSummary(app));
  }
  out.sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')));
  return out;
}

async function getApp(user, name, isAdmin) {
  const client = getClient();
  const app = await fetchOwned(client, user, name, isAdmin);
  return toSummary(app);
}

// Snapshots = the app's revision history. Each deploy/rollback creates a new one.
async function listSnapshots(user, name, isAdmin) {
  const client = getClient();
  await fetchOwned(client, user, name, isAdmin);

  const snapshots = [];
  for await (const rev of client.containerAppsRevisions.listRevisions(
    config.azure.resourceGroup,
    name
  )) {
    const container = (rev.template && rev.template.containers && rev.template.containers[0]) || {};
    snapshots.push({
      revision: rev.name,
      active: rev.active === true,
      createdTime: rev.createdTime || null,
      image: container.image || null,
      replicas: rev.replicas != null ? rev.replicas : null,
      trafficWeight: rev.trafficWeight != null ? rev.trafficWeight : null,
      provisioningState: rev.provisioningState || null,
      healthState: rev.healthState || null,
    });
  }
  snapshots.sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')));
  return snapshots;
}

// Rollback = redeploy the image + template captured by a prior revision, producing a
// new active revision (Single revision mode). This is the "image snapshot" restore.
async function rollback(user, name, revisionName, isAdmin) {
  const client = getClient();
  const app = await fetchOwned(client, user, name, isAdmin);

  let rev;
  try {
    rev = await client.containerAppsRevisions.getRevision(
      config.azure.resourceGroup,
      name,
      revisionName
    );
  } catch (e) {
    throw new ApiError(404, `Revision "${revisionName}" not found.`);
  }
  if (!rev.template) throw new ApiError(400, 'Selected revision has no template to restore.');

  const restored = JSON.parse(JSON.stringify(rev.template));
  // Express rejects a custom revisionSuffix; drop the captured one and let ACA re-derive
  // the revision name when it re-applies this template.
  delete restored.revisionSuffix;

  const envelope = {
    location: app.location,
    tags: app.tags,
    managedEnvironmentId: app.managedEnvironmentId || config.azure.managedEnvironmentId,
    configuration: app.configuration,
    template: restored,
  };
  const updated = await client.containerApps.beginCreateOrUpdateAndWait(
    config.azure.resourceGroup,
    name,
    envelope
  );
  return { restoredFrom: revisionName, app: toSummary(updated) };
}

async function deleteApp(user, name, isAdmin) {
  const client = getClient();
  await fetchOwned(client, user, name, isAdmin);
  await client.containerApps.beginDeleteAndWait(config.azure.resourceGroup, name);
  return { deleted: name };
}

module.exports = {
  ApiError,
  createApp,
  listApps,
  getApp,
  listSnapshots,
  rollback,
  deleteApp,
};
