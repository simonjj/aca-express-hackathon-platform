// Azure Container Apps (Express/Consumption) environment + Log Analytics workspace.
// This single environment hosts the hackathon platform, Keycloak, and every
// participant-deployed application.
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

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-10-02-preview' = {
  name: name
  location: location
  tags: tags
  properties: {
    // Express mode: opinionated scale-to-zero tier. Accepted by ARM/az CLI but not yet
    // in the Bicep type schema (emits BCP037), so we suppress the linter warning.
    #disable-next-line BCP037
    environmentMode: 'Express'
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
output logAnalyticsWorkspaceName string = logAnalytics.name
output logAnalyticsCustomerId string = logAnalytics.properties.customerId
