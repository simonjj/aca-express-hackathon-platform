# Troubleshooting

## Deployment (azd / Bicep)

### `ExpressEnvironmentFeatureNotSupported`
Something tried to use a feature Express doesn't support — managed identity, internal
ingress, KEDA custom scale rules, Dapr, jobs, VNet, or a **`revisionSuffix`** on the app
template. Remove the feature or host that piece on a **standard** ACA environment.

Note that **`azd deploy` always sends a `revisionSuffix`**, so azd-deployed apps (the
platform + Keycloak) must live on a standard env — which is exactly why this template uses
two environments. Only participant apps run on Express. See
[architecture.md](architecture.md#why-two-environments).

### Region / quota errors on `azd up`
ACA Express preview runs only in **westcentralus** and **eastasia**. Choose one of those
locations. If you hit quota, request more or try the other region.

### `ManagedEnvironmentInvalidSchema` on the Express environment
The Express env only deploys via Bicep/ARM at api-version **`2026-03-02-preview`** with
`properties.environmentMode: 'Express'`. Older versions (e.g. `2024-10-02-preview`) reject
the schema. `infra/modules/express-environment.bicep` already pins the correct version.

### `App Logs destination 'none' is not supported`
Express rejects a literal `appLogsConfiguration.destination: 'none'`. The fix is to **omit
the `appLogsConfiguration` block entirely** on the Express env (app logs are simply
disabled there). The standard env keeps `log-analytics`.

### `BCP081` warnings for `2026-03-02-preview`
Benign — the Bicep type index doesn't yet include this preview api-version, so resource
bodies aren't type-checked. Deployment still succeeds.

### `BCP318` warning on `fetch-container-image.bicep`
Benign — a possibly-null reference guarded by a `??` fallback. Matches the upstream
reference template.

### `ServiceManagementReference field is required` creating the SP
In some tenants (e.g. `microsoft.com`), `az ad sp create-for-rbac` requires a service-tree
reference. Supply an existing SP via `azd env set AZURE_PROVISION_CLIENT_ID/SECRET/...`, or
deploy with **provisioning disabled** (the default when no SP is set) and wire it later.
See <https://aka.ms/service-management-reference-error>.

### `ContainerAppSecretInvalid` (empty secret)
An ACA secret with an empty value is rejected. The platform module only defines the
`provision-client-secret` secret when an SP secret is actually provided (`hasProvision`), so
this only appears if you set a blank value manually.

### Required parameters missing on provision
`preprovision` must run before params resolve. If you invoke provisioning outside `azd up`,
run the preprovision hook first (or `azd env set` the generated values), otherwise
`oidcClientId` / secrets are unset.

## Login (EasyAuth / Keycloak)

### `/login` returns 503 "Login unavailable"
Neither EasyAuth nor app-level OIDC is configured. In Azure, confirm the platform app has
`EASYAUTH_ENABLED=true` and an `authConfigs/current` resource; locally, set
`EASYAUTH_ENABLED=false` + `OIDC_*` to use the app-level fallback.

### Login redirect loops or "invalid redirect_uri"
Keycloak's client must allow the EasyAuth callback
`{PLATFORM_URI}/.auth/login/<provider>/callback` (and, for the OIDC fallback,
`{PLATFORM_URI}/auth/callback`). `postprovision` registers both; if you changed the
platform hostname or provider name, re-run `postprovision` or fix the client's valid
redirect URIs in the Keycloak admin console.

### `/.auth/login/...` returns 404 or "provider not found"
The provider key in the `authConfigs` custom-OIDC block must match the name in the
`/.auth/login/<name>` path. Both derive from `OIDC_PROVIDER_NAME` (default `keycloak`); if
you override it, redeploy so the authConfig, the app's `OIDC_PROVIDER_NAME`, and the
Keycloak redirect URI all agree.

### EasyAuth can't reach the OIDC metadata
The custom provider points at `{OIDC_ISSUER}/.well-known/openid-configuration`. That realm
is created by `postprovision`, so the first login must happen after provisioning
completes and Keycloak is healthy.

### Keycloak not ready yet
Keycloak can take a minute to become healthy on first boot. Retry login, or check the
Keycloak container app logs (`az containerapp logs show`).

## Provisioning (deployment API)

### Dashboard shows "provisioning disabled"
Neither a managed identity nor a service principal is configured. Redeploy with
`useManagedIdentityProvisioning=true` (default), or set `AZURE_PROVISION_*` and
`azd deploy platform` so the app picks up the credentials.

### Role assignment fails on `azd up` (`AuthorizationFailed` on `roleAssignments/write`)
Creating the provisioning managed identity assigns it **Contributor** on the RG, which
needs you to be **Owner** or **User Access Administrator**. If you lack that, set
`azd env set USE_MANAGED_IDENTITY_PROVISIONING false` and use a service principal instead.

### `AuthorizationFailed` when creating an app
The provisioning identity (managed identity or SP) lacks **Contributor** on the resource
group. For an SP, re-run the script or grant it:
`az role assignment create --assignee <clientId> --role Contributor
--scope /subscriptions/<sub>/resourceGroups/<rg>`.

### Image pull fails (`UNAUTHORIZED`)
Participant apps run on Express and pull with **ACR admin credentials**, not MI. Ensure the
registry has `adminUserEnabled: true` and that `ACR_USERNAME` / `ACR_PASSWORD` are set on
the platform app. Public images (e.g. `mcr.microsoft.com/...`) need no credentials.

### 401 from `/api/*`
Missing/expired token. Re-open the dashboard to mint a fresh token, or send a valid session
cookie. Tokens are JWTs signed with `PLATFORM_API_SECRET` and expire after 30 days.

## Note on EasyAuth vs Express
Login uses **ACA EasyAuth** (custom OIDC → Keycloak) on the **standard** environment that
hosts the control plane. EasyAuth isn't available on Express, but the platform app doesn't
run there — only participant apps do. To switch the IdP to Entra ID, see
[keycloak-to-entraid.md](keycloak-to-entraid.md).
