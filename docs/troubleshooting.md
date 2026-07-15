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

## Login (Keycloak / OIDC)

### `/login` returns 503 "OIDC is not configured"
`OIDC_ISSUER` / `OIDC_CLIENT_ID` are unset — expected when running locally or before
`postprovision` completes. After `azd up`, confirm the platform app has the `OIDC_*` env
vars and that Keycloak is reachable at **KEYCLOAK_URI**.

### Login redirect loops or "invalid redirect_uri"
Keycloak's client must allow `{PLATFORM_URI}/auth/callback`. `postprovision` sets this; if
you changed the platform hostname, re-run `postprovision` or update the client's valid
redirect URIs in the Keycloak admin console.

### Keycloak not ready yet
Keycloak can take a minute to become healthy on first boot. Retry login, or check the
Keycloak container app logs (`az containerapp logs show`).

## Provisioning (deployment API)

### Dashboard shows "provisioning disabled"
`AZURE_PROVISION_*` aren't set. Run `scripts/create-provisioner-sp.*`, then redeploy the
platform (`azd deploy platform`) so the app picks up the new secrets.

### `AuthorizationFailed` when creating an app
The service principal lacks **Contributor** on the resource group. Re-run the SP script or
grant the role: `az role assignment create --assignee <clientId> --role Contributor
--scope /subscriptions/<sub>/resourceGroups/<rg>`.

### Image pull fails (`UNAUTHORIZED`)
Express pulls with **ACR admin credentials**, not MI. Ensure the registry has
`adminUserEnabled: true` and that `ACR_USERNAME` / `ACR_PASSWORD` are set on the platform
app. Public images (e.g. `mcr.microsoft.com/...`) need no credentials.

### 401 from `/api/*`
Missing/expired token. Re-open the dashboard to mint a fresh token, or send a valid session
cookie. Tokens are JWTs signed with `PLATFORM_API_SECRET` and expire after 30 days.

## "Why not EasyAuth?"
The reference EasyAuth sidecar depends on managed identity, which Express doesn't provide.
We therefore implement OIDC **in the app** with `openid-client`. If you move the control
plane to a standard environment you can switch back to EasyAuth or Entra ID — see
[keycloak-to-entraid.md](keycloak-to-entraid.md).
