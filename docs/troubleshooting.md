# Troubleshooting

## Deployment (azd / Bicep)

### `ExpressEnvironmentFeatureNotSupported`
You (or a customization) tried to use a feature Express doesn't support — managed identity,
internal ingress, KEDA custom scale rules, Dapr, jobs, or VNet. Remove the feature or host
that piece on a standard ACA environment. See
[architecture.md](architecture.md#notable-express-constraints-design-drivers).

### Region / quota errors on `azd up`
ACA Express preview runs only in **westcentralus** and **eastasia**. Choose one of those
locations. If you hit quota, request more or try the other region.

### `BCP037: environmentMode is not an allowed property`
Expected and harmless. `environmentMode` is newer than the Bicep type definitions, so we
pass it with `#disable-next-line BCP037`. ARM still honors it and creates an Express env.

### `BCP318` warning on `fetch-container-image.bicep`
Benign — a possibly-null reference guarded by a `??` fallback. Matches the upstream
reference template.

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
