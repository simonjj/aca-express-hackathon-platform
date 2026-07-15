# Switching from Keycloak to Entra ID

The platform speaks standard **OIDC Authorization Code + PKCE** via `openid-client`
(`src/platform/lib/oidc.js`). Keycloak is just the default provider — any compliant OIDC
issuer works, including **Microsoft Entra ID**. Nothing in the app code changes; you only
repoint configuration.

## 1. Register an app in Entra ID

In the Entra admin center → **App registrations** → **New registration**:

- **Redirect URI** (Web): `https://<PLATFORM_URI>/auth/callback`
- Create a **client secret** (Certificates & secrets).
- Note the **Application (client) ID**, **Directory (tenant) ID**, and the secret value.

## 2. Point the platform at Entra

Set these on the platform app (via `azd env set` then `azd deploy platform`, or directly on
the container app):

| Variable | Value |
|----------|-------|
| `OIDC_ISSUER` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `OIDC_CLIENT_ID` | Entra **Application (client) ID** |
| `OIDC_CLIENT_SECRET` | the client secret you created |
| `OIDC_PROVIDER_NAME` | `entra` (label only) |

`openid-client` discovers everything else from
`https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration`.

```bash
azd env set OIDC_ISSUER "https://login.microsoftonline.com/<tenant-id>/v2.0"
azd env set OIDC_CLIENT_ID "<client-id>"
azd env set OIDC_CLIENT_SECRET "<client-secret>"
azd env set OIDC_PROVIDER_NAME "entra"
azd deploy platform
```

## 3. Skip / remove Keycloak (optional)

Once on Entra you no longer need the Keycloak module:

- Remove (or don't deploy) `infra/modules/keycloak.bicep` and its wiring in
  `infra/main.bicep`.
- The `postprovision` hook's Keycloak realm/client/user setup is a no-op you can delete.

## 4. Identity mapping

The app uses the OIDC `sub` claim as the stable user id (`hackathon-owner` tag) and `name`
/ `email` claims for display. Entra ID provides all three, so ownership isolation, the
dashboard, and admin detection (`ADMIN_USERS`, matched against email/`preferred_username`)
work unchanged. Populate `ADMIN_USERS` with the Entra emails/UPNs that should see all apps.

## Notes

- Entra ID requires the exact redirect URI to be registered; update it if the platform
  hostname changes.
- For multi-tenant sign-in, use the `organizations` or `common` authority in `OIDC_ISSUER`
  and configure the registration accordingly.
- This is a configuration change only — no code edits, matching the app-level OIDC design
  described in [architecture.md](architecture.md).
