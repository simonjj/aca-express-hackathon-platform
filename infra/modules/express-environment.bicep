// Azure Container Apps **Express** environment — the target where the platform
// provisions participant apps (apps/APIs/static sites). Express is an opinionated,
// scale-to-zero tier selected via `environmentMode: 'Express'`.
//
// This is created with API version 2026-03-02-preview, which is the first version whose
// published schema accepts `environmentMode` in an ARM/Bicep template deployment (older
// versions fail preflight with `ManagedEnvironmentInvalidSchema`). Express manages its
// own logging, so `appLogsConfiguration` is omitted entirely (the API rejects a literal
// destination of 'none'; omitting the block is the supported way to disable app logs).
param name string
param location string = resourceGroup().location
param tags object = {}

resource expressEnvironment 'Microsoft.App/managedEnvironments@2026-03-02-preview' = {
  name: name
  location: location
  tags: tags
  properties: {
    environmentMode: 'Express'
  }
}

output name string = expressEnvironment.name
output id string = expressEnvironment.id
output domain string = expressEnvironment.properties.defaultDomain
