#!/usr/bin/env pwsh
# Creates (or reuses) the service principal the platform uses to provision participant
# apps, grants it Contributor on the target resource group, and stores its credentials
# in the azd environment. Run this BEFORE `azd up` (or between `azd provision` runs).
#
# Requires: az CLI logged in with rights to create an app registration + role
# assignment. In tenants that block app-registration credential creation, ask an
# administrator to create the SP and instead run:
#   azd env set AZURE_PROVISION_TENANT_ID   <tenant>
#   azd env set AZURE_PROVISION_CLIENT_ID   <appId>
#   azd env set AZURE_PROVISION_CLIENT_SECRET <secret>

param(
  [string]$Name = "sp-hackathon-platform-$((Get-Random -Maximum 99999))",
  [string]$ResourceGroup
)

$ErrorActionPreference = 'Stop'

$sub = az account show --query id -o tsv
$tenant = az account show --query tenantId -o tsv
if ([string]::IsNullOrWhiteSpace($ResourceGroup)) {
  $envName = azd env get-value AZURE_ENV_NAME 2>$null
  if ([string]::IsNullOrWhiteSpace($envName)) { throw "Pass -ResourceGroup or run 'azd env new' first." }
  $ResourceGroup = "rg-$envName"
}

$scope = "/subscriptions/$sub/resourceGroups/$ResourceGroup"
Write-Host "Creating service principal '$Name' with Contributor on $scope ..." -ForegroundColor Cyan

# The RG may not exist yet; Contributor at subscription scope is a fallback so the SP
# can create the RG-scoped resources. We scope to the RG when it exists.
$rgExists = az group exists -n $ResourceGroup | Select-Object -First 1
if ($rgExists -ne 'true') {
  Write-Host "Resource group not found yet; scoping SP to the subscription instead." -ForegroundColor Yellow
  $scope = "/subscriptions/$sub"
}

$sp = az ad sp create-for-rbac --name $Name --role Contributor --scopes $scope -o json | ConvertFrom-Json

azd env set AZURE_PROVISION_TENANT_ID   $sp.tenant   | Out-Null
azd env set AZURE_PROVISION_CLIENT_ID   $sp.appId    | Out-Null
azd env set AZURE_PROVISION_CLIENT_SECRET $sp.password | Out-Null

Write-Host "Stored AZURE_PROVISION_* in the azd environment." -ForegroundColor Green
Write-Host "  tenant : $($sp.tenant)"
Write-Host "  appId  : $($sp.appId)"
Write-Host "Now run 'azd up' (or 'azd provision')." -ForegroundColor Cyan
