// Standard Azure Container Apps environment (regular ACA Bicep) that hosts the two
// control-plane apps: Keycloak and the hackathon platform itself. These run here (not on
// Express) so that: (a) `azd deploy` works normally — Express rejects the revision
// suffix azd uses, and (b) they avoid the Express first-boot provisioning race. The
// participant apps the platform creates target the separate **Express** environment
// (see express-environment.bicep).
param name string
param location string = resourceGroup().location
param tags object = {}
param logAnalyticsWorkspaceName string

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2026-03-02-preview' = {
  name: name
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

output name string = containerAppsEnvironment.name
output id string = containerAppsEnvironment.id
output domain string = containerAppsEnvironment.properties.defaultDomain
