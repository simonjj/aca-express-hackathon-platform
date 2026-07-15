// Self-hosted Keycloak as the custom OpenID Connect provider for ACA EasyAuth.
// Stands in for Entra ID so the platform works in tenants that restrict app
// registration credential creation. Swap for Entra ID later (see docs).
param name string
param location string = resourceGroup().location
param tags object = {}
param containerAppsEnvironmentName string
param environmentDefaultDomain string

param adminUsername string = 'admin'
@secure()
param adminPassword string

param image string = 'quay.io/keycloak/keycloak:26.0'
param targetPort int = 8080

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2026-03-02-preview' existing = {
  name: containerAppsEnvironmentName
}

// The Keycloak FQDN is deterministic once the environment exists: <name>.<defaultDomain>.
var baseUrl = 'https://${name}.${environmentDefaultDomain}'

resource keycloak 'Microsoft.App/containerApps@2026-03-02-preview' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'keycloak' })
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
      secrets: [
        {
          name: 'kc-admin-password'
          value: adminPassword
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'keycloak'
          image: image
          args: ['start-dev']
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
          env: [
            {
              name: 'KC_BOOTSTRAP_ADMIN_USERNAME'
              value: adminUsername
            }
            {
              name: 'KC_BOOTSTRAP_ADMIN_PASSWORD'
              secretRef: 'kc-admin-password'
            }
            // Force the public HTTPS issuer so discovery/tokens match the ACA FQDN.
            {
              name: 'KC_HOSTNAME'
              value: baseUrl
            }
            {
              name: 'KC_HTTP_ENABLED'
              value: 'true'
            }
            {
              name: 'KC_PROXY_HEADERS'
              value: 'xforwarded'
            }
            {
              name: 'KC_HEALTH_ENABLED'
              value: 'true'
            }
          ]
        }
      ]
      scale: {
        // Single in-memory instance keeps the demo realm config consistent.
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output name string = keycloak.name
output fqdn string = keycloak.properties.configuration.ingress.fqdn
output baseUrl string = baseUrl
