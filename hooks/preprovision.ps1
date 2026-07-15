#!/usr/bin/env pwsh
# preprovision hook — generates the secrets the platform needs and writes them into
# the azd environment so main.bicep can consume them. No Entra/az-ad calls are made,
# which keeps the template usable in tenants that block app-registration credential
# creation. Idempotent: existing values are reused.
#
#   OIDC_CLIENT_ID          - client id registered in Keycloak + used by the platform
#   OIDC_CLIENT_SECRET      - shared client secret (platform <-> Keycloak)
#   KEYCLOAK_ADMIN_PASSWORD - Keycloak bootstrap admin password
#   PLATFORM_API_SECRET     - HMAC secret used to sign per-user API tokens
#   SESSION_SECRET          - secret used to sign browser session cookies
#
# The provisioning Service Principal (AZURE_PROVISION_CLIENT_ID/SECRET/TENANT_ID) is
# NOT generated here — set it with scripts/create-provisioner-sp.ps1 or `azd env set`.

$ErrorActionPreference = 'Stop'

function Set-AzdEnv([string]$Key, [string]$Value) {
  azd env set $Key $Value | Out-Null
}

function New-Key {
  # base64 of 32 random bytes — used for HMAC/session secrets.
  $bytes = New-Object 'System.Byte[]' 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes)
}

function New-Secret {
  # URL-safe-ish random secret (no padding chars that upset form posts).
  $bytes = New-Object 'System.Byte[]' 24
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
}

$clientId = $env:OIDC_CLIENT_ID
if ([string]::IsNullOrWhiteSpace($clientId)) { $clientId = 'hackathon-platform'; Write-Host '==> Set OIDC client id.' }

$clientSecret = $env:OIDC_CLIENT_SECRET
if ([string]::IsNullOrWhiteSpace($clientSecret)) { $clientSecret = New-Secret; Write-Host '==> Generated OIDC client secret.' }

$adminPass = $env:KEYCLOAK_ADMIN_PASSWORD
if ([string]::IsNullOrWhiteSpace($adminPass)) { $adminPass = New-Secret; Write-Host '==> Generated Keycloak admin password.' }

$apiSecret = $env:PLATFORM_API_SECRET
if ([string]::IsNullOrWhiteSpace($apiSecret)) { $apiSecret = New-Key; Write-Host '==> Generated platform API secret.' }

$sessionSecret = $env:SESSION_SECRET
if ([string]::IsNullOrWhiteSpace($sessionSecret)) { $sessionSecret = New-Key; Write-Host '==> Generated session secret.' }

Set-AzdEnv 'OIDC_CLIENT_ID' $clientId
Set-AzdEnv 'OIDC_CLIENT_SECRET' $clientSecret
Set-AzdEnv 'KEYCLOAK_ADMIN_PASSWORD' $adminPass
Set-AzdEnv 'PLATFORM_API_SECRET' $apiSecret
Set-AzdEnv 'SESSION_SECRET' $sessionSecret

if ([string]::IsNullOrWhiteSpace($env:AZURE_PROVISION_CLIENT_ID)) {
  Write-Host '==> NOTE: no provisioning service principal set. The platform will deploy but'
  Write-Host '          participant deployments are DISABLED until you run'
  Write-Host '          scripts/create-provisioner-sp.ps1 (or set AZURE_PROVISION_* via azd env set).'
}

Write-Host '==> preprovision complete. Platform secrets ready.'
