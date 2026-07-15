#!/usr/bin/env pwsh
# postprovision hook: configure the Keycloak stand-in IdP for the platform's
# app-level OIDC login. Creates (idempotently) the realm, a confidential client whose
# redirect URI is the platform's /auth/callback, and a test user. Values come from
# azd outputs (surfaced as env vars).

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$kcUrl        = $env:KEYCLOAK_URI
$adminUser    = $env:KEYCLOAK_ADMIN_USERNAME
$adminPass    = $env:KEYCLOAK_ADMIN_PASSWORD
$realm        = $env:OIDC_REALM
$clientId     = $env:OIDC_CLIENT_ID
$clientSecret = $env:OIDC_CLIENT_SECRET
$redirectUri  = $env:PLATFORM_REDIRECT_URI
$webUri       = $env:PLATFORM_URI

$testUser = 'testuser'
$testPass = 'Password123!'

foreach ($pair in @(
    @{ n = 'KEYCLOAK_URI'; v = $kcUrl },
    @{ n = 'KEYCLOAK_ADMIN_USERNAME'; v = $adminUser },
    @{ n = 'KEYCLOAK_ADMIN_PASSWORD'; v = $adminPass },
    @{ n = 'OIDC_REALM'; v = $realm },
    @{ n = 'OIDC_CLIENT_ID'; v = $clientId },
    @{ n = 'OIDC_CLIENT_SECRET'; v = $clientSecret },
    @{ n = 'PLATFORM_REDIRECT_URI'; v = $redirectUri },
    @{ n = 'PLATFORM_URI'; v = $webUri })) {
    if ([string]::IsNullOrWhiteSpace($pair.v)) {
        throw "Required environment variable '$($pair.n)' is not set. Run this via 'azd provision'/'azd up'."
    }
}

Write-Host "Configuring Keycloak at $kcUrl (realm '$realm', client '$clientId')" -ForegroundColor Cyan

# --- 1. Wait for Keycloak to be ready --------------------------------------
$ready = $false
for ($i = 1; $i -le 60; $i++) {
    try {
        Invoke-RestMethod -Method Get -Uri "$kcUrl/realms/master/.well-known/openid-configuration" -TimeoutSec 15 | Out-Null
        $ready = $true
        break
    } catch {
        Write-Host "  waiting for Keycloak to start... ($i/60)"
        Start-Sleep -Seconds 10
    }
}
if (-not $ready) { throw "Keycloak did not become ready at $kcUrl" }
Write-Host "Keycloak is up." -ForegroundColor Green

# --- 2. Admin token --------------------------------------------------------
$body = @{
    grant_type = 'password'
    client_id  = 'admin-cli'
    username   = $adminUser
    password   = $adminPass
}
$tokenResp = Invoke-RestMethod -Method Post `
    -Uri "$kcUrl/realms/master/protocol/openid-connect/token" `
    -ContentType 'application/x-www-form-urlencoded' -Body $body
$authHeader = @{ Authorization = "Bearer $($tokenResp.access_token)" }
$adminBase = "$kcUrl/admin/realms"

function Invoke-Kc {
    param([string]$Method, [string]$Path, $Body)
    $uri = "$adminBase$Path"
    $params = @{ Method = $Method; Uri = $uri; Headers = $authHeader }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json'
        $params.Body = ($Body | ConvertTo-Json -Depth 20)
    }
    return Invoke-RestMethod @params
}

# --- 3. Realm --------------------------------------------------------------
$realmExists = $false
try { Invoke-Kc -Method Get -Path "/$realm" | Out-Null; $realmExists = $true } catch { $realmExists = $false }
if ($realmExists) {
    Write-Host "Realm '$realm' already exists."
} else {
    Write-Host "Creating realm '$realm'..."
    Invoke-Kc -Method Post -Path '' -Body @{
        realm                 = $realm
        enabled               = $true
        sslRequired           = 'external'
        registrationAllowed   = $false
        loginWithEmailAllowed = $true
    } | Out-Null
}

# --- 4. Client -------------------------------------------------------------
$redirectUris = @($redirectUri, "$webUri/auth/*", "$webUri/*")
$existing = Invoke-Kc -Method Get -Path "/$realm/clients?clientId=$clientId"
$clientRep = @{
    clientId                  = $clientId
    protocol                  = 'openid-connect'
    publicClient              = $false
    clientAuthenticatorType   = 'client-secret'
    secret                    = $clientSecret
    standardFlowEnabled       = $true
    directAccessGrantsEnabled = $false
    serviceAccountsEnabled    = $false
    redirectUris              = $redirectUris
    webOrigins                = @($webUri)
    attributes                = @{ 'post.logout.redirect.uris' = "$webUri/*" }
}
if ($existing.Count -gt 0) {
    $uuid = $existing[0].id
    Write-Host "Updating existing client '$clientId' ($uuid)..."
    Invoke-Kc -Method Put -Path "/$realm/clients/$uuid" -Body $clientRep | Out-Null
} else {
    Write-Host "Creating client '$clientId'..."
    Invoke-Kc -Method Post -Path "/$realm/clients" -Body $clientRep | Out-Null
}

# --- 5. Test user ----------------------------------------------------------
$users = Invoke-Kc -Method Get -Path "/$realm/users?username=$testUser&exact=true"
$userRep = @{
    username      = $testUser
    enabled       = $true
    emailVerified = $true
    email         = 'testuser@example.com'
    firstName     = 'Test'
    lastName      = 'User'
    credentials   = @(@{ type = 'password'; value = $testPass; temporary = $false })
}
if ($users.Count -gt 0) {
    $uid = $users[0].id
    Write-Host "Updating existing user '$testUser' ($uid)..."
    Invoke-Kc -Method Put -Path "/$realm/users/$uid" -Body $userRep | Out-Null
} else {
    Write-Host "Creating user '$testUser'..."
    Invoke-Kc -Method Post -Path "/$realm/users" -Body $userRep | Out-Null
}

Write-Host ""
Write-Host "Keycloak configured successfully." -ForegroundColor Green
Write-Host "  Platform      : $webUri"
Write-Host "  Login with    : $testUser / $testPass"
Write-Host "  Discovery     : $($env:OIDC_WELL_KNOWN_URL)"
if ([string]::IsNullOrWhiteSpace($env:AZURE_PROVISION_CLIENT_ID)) {
  Write-Host ""
  Write-Host "  NOTE: participant deployments are DISABLED (no provisioning SP set)." -ForegroundColor Yellow
  Write-Host "        Run scripts/create-provisioner-sp.ps1 then 'azd provision' again." -ForegroundColor Yellow
}
Write-Host ""
