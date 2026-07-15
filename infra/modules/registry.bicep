// Shared Azure Container Registry. Holds the platform image and (optionally)
// participant-built images pushed for the `container` deployment method.
// adminUser is enabled so the platform can hand short-lived registry credentials
// to participant apps without creating a role assignment per deployment.
param name string
param location string = resourceGroup().location
param tags object = {}

param adminUserEnabled bool = true
param sku object = {
  name: 'Standard'
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: sku
  properties: {
    adminUserEnabled: adminUserEnabled
    anonymousPullEnabled: false
    publicNetworkAccess: 'Enabled'
    networkRuleBypassOptions: 'AzureServices'
  }
}

output loginServer string = containerRegistry.properties.loginServer
output name string = containerRegistry.name
