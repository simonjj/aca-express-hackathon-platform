// User-assigned managed identity used by the platform to provision participant apps via
// ARM. The platform app runs on a STANDARD ACA environment, so it can carry a managed
// identity (Express apps cannot) — the identity only needs Contributor on this resource
// group to create/update/delete container apps in the Express target environment.
param name string
param location string = resourceGroup().location
param tags object = {}

@description('Role definition GUID to grant the identity on the resource group. Defaults to the built-in Contributor role (public-cloud id); override for clouds/tenants that use a different built-in GUID.')
param contributorRoleDefinitionId string = 'b24988ac-6180-42a0-af88-d01a01e28e30'

// Contributor: create/manage container apps (and read the environments) in this RG.
var contributorRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  contributorRoleDefinitionId
)

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}

resource contributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, identity.id, contributorRoleId)
  properties: {
    roleDefinitionId: contributorRoleId
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output id string = identity.id
output clientId string = identity.properties.clientId
output principalId string = identity.properties.principalId
output name string = identity.name
