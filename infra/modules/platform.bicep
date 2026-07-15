// The hackathon platform itself: a single ACA **Express** container app that serves
// the public homepage, the authenticated dashboard, and the deployment API.
//
// IMPORTANT (Express constraints): Express apps support NEITHER managed identity NOR
// internal ingress. Therefore:
//   * the app authenticates to ARM with a Service Principal client secret (to create
//     participant apps on their behalf), and
//   * it pulls its own image from ACR using the registry admin credentials.
// Login is Keycloak OIDC handled at the application layer (not the EasyAuth sidecar).
param name string
param location string = resourceGroup().location
param tags object = {}
param serviceName string = 'platform'

param containerRegistryName string
// Standard (host) environment this control-plane app runs in.
param containerAppsEnvironmentName string
param environmentDefaultDomain string
// Express environment that participant apps are provisioned into (the deployment target).
param targetEnvironmentId string
param targetEnvironmentName string
param targetEnvironmentDomain string
param exists bool
param targetPort int = 8080

@description('Default replica size handed to new deployments when the caller omits one.')
param defaultReplicaSize string = '1cpu2ram'

@description('Comma-separated list of usernames granted the admin view (all apps).')
param adminUsers string = ''

// --- Keycloak OIDC (app-level Authorization Code flow) ---
param providerName string
param oidcClientId string
@secure()
param oidcClientSecret string
param oidcIssuer string

// --- Service Principal used to provision participant apps via ARM ---
param provisionTenantId string = ''
param provisionClientId string = ''
@secure()
param provisionClientSecret string = ''

// --- App secrets ---
@secure()
param platformApiSecret string
@secure()
param sessionSecret string

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' existing = {
  name: containerRegistryName
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2026-03-02-preview' existing = {
  name: containerAppsEnvironmentName
}

module fetchLatestImage './fetch-container-image.bicep' = {
  name: '${name}-fetch-image'
  params: {
    exists: exists
    name: name
  }
}

// Deterministic public FQDN of this external Express app (used for the OIDC redirect
// URI, computed here to avoid a self-referential dependency cycle).
var baseUrl = 'https://${name}.${environmentDefaultDomain}'
var acrLoginServer = '${containerRegistryName}.azurecr.io'
var acrUsername = containerRegistry.listCredentials().username
var acrPassword = containerRegistry.listCredentials().passwords[0].value

// The provisioning Service Principal is optional: when it isn't configured the platform
// runs with participant deployments disabled. An empty container-app secret value is
// rejected by ACA, so the secret and its env vars are only emitted when a secret exists.
var hasProvision = !empty(provisionClientSecret)

var coreSecrets = [
  { name: 'acr-password', value: acrPassword }
  { name: 'oidc-client-secret', value: oidcClientSecret }
  { name: 'platform-api-secret', value: platformApiSecret }
  { name: 'session-secret', value: sessionSecret }
]
var secrets = hasProvision ? concat(coreSecrets, [
  { name: 'provision-client-secret', value: provisionClientSecret }
]) : coreSecrets

var coreEnv = [
  { name: 'PORT', value: string(targetPort) }
  { name: 'PLATFORM_BASE_URL', value: baseUrl }
  // ARM / provisioning context
  { name: 'AZURE_SUBSCRIPTION_ID', value: subscription().subscriptionId }
  { name: 'AZURE_RESOURCE_GROUP', value: resourceGroup().name }
  { name: 'AZURE_LOCATION', value: location }
  { name: 'MANAGED_ENVIRONMENT_ID', value: targetEnvironmentId }
  { name: 'MANAGED_ENVIRONMENT_NAME', value: targetEnvironmentName }
  { name: 'ACA_DEFAULT_DOMAIN', value: targetEnvironmentDomain }
  { name: 'ACR_NAME', value: containerRegistryName }
  { name: 'ACR_LOGIN_SERVER', value: acrLoginServer }
  { name: 'ACR_USERNAME', value: acrUsername }
  { name: 'ACR_PASSWORD', secretRef: 'acr-password' }
  { name: 'DEFAULT_REPLICA_SIZE', value: defaultReplicaSize }
  { name: 'ADMIN_USERS', value: adminUsers }
  // Keycloak OIDC (app-level)
  { name: 'OIDC_PROVIDER_NAME', value: providerName }
  { name: 'OIDC_ISSUER', value: oidcIssuer }
  { name: 'OIDC_CLIENT_ID', value: oidcClientId }
  { name: 'OIDC_CLIENT_SECRET', secretRef: 'oidc-client-secret' }
  // App secrets
  { name: 'PLATFORM_API_SECRET', secretRef: 'platform-api-secret' }
  { name: 'SESSION_SECRET', secretRef: 'session-secret' }
]
// Service Principal (no MI on Express) — only when configured.
var provisionEnv = hasProvision ? [
  { name: 'AZURE_TENANT_ID', value: provisionTenantId }
  { name: 'AZURE_PROVISION_CLIENT_ID', value: provisionClientId }
  { name: 'AZURE_PROVISION_CLIENT_SECRET', secretRef: 'provision-client-secret' }
] : []
var env = concat(coreEnv, provisionEnv)

resource app 'Microsoft.App/containerApps@2026-03-02-preview' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': serviceName })
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: acrLoginServer
          username: acrUsername
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: secrets
    }
    template: {
      containers: [
        {
          image: fetchLatestImage.outputs.?containers[?0].?image ?? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          name: 'platform'
          env: env
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
        }
      ]
      scale: {
        // Express supports up to 2 min-replicas and no custom scale rules.
        minReplicas: 1
        maxReplicas: 2
      }
    }
  }
}

output name string = app.name
output id string = app.id
output fqdn string = app.properties.configuration.ingress.fqdn
output uri string = baseUrl
