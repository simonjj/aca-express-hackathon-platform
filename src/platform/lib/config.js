'use strict';

// Centralised configuration read from environment variables (populated by the
// platform.bicep container app definition). Everything degrades gracefully so the
// app can boot locally with no Azure wiring for UI development.

const bool = (v, d = false) => (v == null ? d : String(v).toLowerCase() === 'true');

const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  baseUrl: (process.env.PLATFORM_BASE_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, ''),

  // Azure / provisioning (Service Principal — Express has no managed identity).
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

  apiSecret: process.env.PLATFORM_API_SECRET || 'dev-insecure-api-secret',
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-session-secret',

  homepageMarkdown: process.env.HOMEPAGE_MARKDOWN || '',
};

// Provisioning is only possible when a service principal is configured.
config.provisioningEnabled = bool(
  config.azure.subscriptionId &&
    config.azure.resourceGroup &&
    config.azure.tenantId &&
    config.azure.clientId &&
    config.azure.clientSecret
    ? 'true'
    : 'false'
);

// OIDC login is only possible when an issuer is configured.
config.oidcEnabled = Boolean(config.oidc.issuer && config.oidc.clientId);

module.exports = config;
