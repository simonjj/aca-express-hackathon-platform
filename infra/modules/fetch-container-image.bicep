// Helper: read the current image of an existing container app so redeploys keep
// the last-built image instead of resetting to the placeholder. Used by azd.
param exists bool
param name string

resource existingApp 'Microsoft.App/containerApps@2023-05-02-preview' existing = if (exists) {
  name: name
}

output containers array = exists ? existingApp.properties.template.containers : []
