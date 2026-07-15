'use strict';

// Centralised configuration read from environment variables (populated by the
// platform.bicep container app definition). Everything degrades gracefully so the
// app can boot locally with no Azure wiring for UI development.

const bool = (v, d = false) => (v == null ? d : String(v).toLowerCase() === 'true');

const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  baseUrl: (process.env.PLATFORM_BASE_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, ''),

  // Azure / provisioning. The control plane runs on a STANDARD ACA env, so it can use a
  // user-assigned managed identity (default) or a service principal (override) to call
  // ARM. Participant apps land on the Express env (which itself has no managed identity).
  azure: {
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || '',
    resourceGroup: process.env.AZURE_RESOURCE_GROUP || '',
    location: process.env.AZURE_LOCATION || 'westcentralus',
    managedEnvironmentId: process.env.MANAGED_ENVIRONMENT_ID || '',
    managedEnvironmentName: process.env.MANAGED_ENVIRONMENT_NAME || '',
    defaultDomain: process.env.ACA_DEFAULT_DOMAIN || '',
    tenantId: process.env.AZURE_TENANT_ID || '',
    clientId: process.env.AZURE_PROVISION_CLIENT_ID || '',
    clientSecret: process.env.AZURE_PROVISION_CLIENT_SECRET || '',
    // Managed-identity provisioning (default). AZURE_CLIENT_ID selects the UAMI.
    useManagedIdentity: bool(process.env.AZURE_USE_MANAGED_IDENTITY),
    managedIdentityClientId: process.env.AZURE_CLIENT_ID || '',
  },

  acr: {
    name: process.env.ACR_NAME || '',
    loginServer: process.env.ACR_LOGIN_SERVER || '',
    username: process.env.ACR_USERNAME || '',
    password: process.env.ACR_PASSWORD || '',
  },

  defaultReplicaSize: process.env.DEFAULT_REPLICA_SIZE || '1cpu2ram',
  adminUsers: (process.env.ADMIN_USERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  oidc: {
    providerName: process.env.OIDC_PROVIDER_NAME || 'keycloak',
    issuer: process.env.OIDC_ISSUER || '',
    clientId: process.env.OIDC_CLIENT_ID || '',
    clientSecret: process.env.OIDC_CLIENT_SECRET || '',
    redirectUri: `${(process.env.PLATFORM_BASE_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, '')}/auth/callback`,
  },

  // When true, login is handled by the ACA EasyAuth sidecar (Keycloak custom OIDC
  // provider). The app then reads the injected X-MS-CLIENT-PRINCIPAL* headers instead of
  // running the OIDC code flow itself. Set by platform.bicep.
  easyAuthEnabled: bool(process.env.EASYAUTH_ENABLED),

  apiSecret: process.env.PLATFORM_API_SECRET || 'dev-insecure-api-secret',
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-session-secret',

  homepageMarkdown: process.env.HOMEPAGE_MARKDOWN || '',
};

// Provisioning works with either a user-assigned managed identity (preferred, control
// plane runs on a standard env) or a service principal client secret (override).
const spConfigured = Boolean(
  config.azure.subscriptionId &&
    config.azure.resourceGroup &&
    config.azure.tenantId &&
    config.azure.clientId &&
    config.azure.clientSecret
);
const miConfigured = Boolean(
  config.azure.subscriptionId && config.azure.resourceGroup && config.azure.useManagedIdentity
);
config.provisioningEnabled = spConfigured || miConfigured;
// The credential the provisioner uses (SP takes precedence when fully configured).
config.provisioningMode = spConfigured ? 'service-principal' : miConfigured ? 'managed-identity' : 'disabled';

// OIDC (app-level) login is possible when an issuer is configured; EasyAuth login is
// possible when the sidecar is enabled. Either enables the Sign-in affordances.
config.oidcEnabled = Boolean(config.oidc.issuer && config.oidc.clientId);
config.loginEnabled = config.easyAuthEnabled || config.oidcEnabled;

module.exports = config;
