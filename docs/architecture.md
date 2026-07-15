# Architecture

## Overview

The platform is a **Node/Express** app that serves the public homepage, handles OIDC
login, exposes a deployment API, and provisions participant apps via ARM.

It spans **two ACA environments**: the control plane (platform app + Keycloak) runs on a
**standard** environment, and participant apps are provisioned into a dedicated **Express**
environment. See [Why two environments](#why-two-environments).

```
 ┌────────────── standard ACA environment ──────────────┐   ┌──── ACA Express env ────┐
 │                                                       │   │                         │
 │  ┌───────────────┐        ┌───────────────┐           │   │  ┌──────────────────┐   │
 │  │  Keycloak     │  OIDC  │  Platform app │  ARM (SP) │   │  │ participant apps │   │
 │  │  (OIDC IdP)   │◄──────►│  (this repo)  │───────────┼───┼─►│ h<hash>-<name>…  │   │
 │  └───────────────┘        └──────┬────────┘           │   │  └──────────────────┘   │
 │                                  │ pull               │   └─────────────────────────┘
 │                                  ▼                     │
 │                         ┌──────────────┐              │   (shared ACR, admin creds,
 │                         │  ACR (admin) │              │    used by apps in both envs)
 │                         └──────────────┘              │
 └───────────────────────────────────────────────────────┘
```

## Why two environments

ACA **Express** is the intended compute tier, but it can't host the control plane:

- **`azd deploy` fails on Express** — it rejects the `revisionSuffix` azd sends
  (`ExpressEnvironmentFeatureNotSupported: 'Revision Suffix' is not supported ... on
  express environments`).
- Express's slower first-boot path also races azd/ARM provisioning timeouts.

So Keycloak and the platform app run on a **standard** environment (normal ACA Bicep,
`azd deploy` works), while a separate **Express** environment is the deployment **target**
for participant apps. The platform receives the Express env's id/name/domain as env vars
(`MANAGED_ENVIRONMENT_ID`, `MANAGED_ENVIRONMENT_NAME`, `ACA_DEFAULT_DOMAIN`) and creates
apps there; participant URLs use the Express env's default domain.

## Components

| Component | Module | Notes |
|-----------|--------|-------|
| Standard ACA environment | `infra/modules/environment-standard.bicep` | Hosts platform + Keycloak; `log-analytics` app logs. |
| Express ACA environment | `infra/modules/express-environment.bicep` | `environmentMode: 'Express'` at api `2026-03-02-preview`, no `appLogsConfiguration`. Participant-app target. |
| Container registry | `infra/modules/registry.bicep` | `adminUserEnabled: true` — Express can't pull with MI. |
| Keycloak | `infra/modules/keycloak.bicep` | Self-hosted OIDC provider on the standard env, public ingress. |
| Platform app | `infra/modules/platform.bicep` | Runs on the standard env; external ingress, EasyAuth + managed identity + secret env, min 1 / max 2 replicas. |

## Request / data flow

1. **Browse** → `/` renders `content/homepage.md` (or `HOMEPAGE_MARKDOWN`) in the HUD theme.
2. **Login** → `/login` redirects to the ACA **EasyAuth** endpoint
   `/.auth/login/<provider>`; the sidecar runs the OIDC code flow against Keycloak and,
   on return, injects the `X-MS-CLIENT-PRINCIPAL*` headers. `lib/auth.js` reads them into
   the request user. (A legacy app-level `openid-client` flow in `lib/oidc.js` remains as
   a fallback when EasyAuth is disabled.)
3. **Dashboard** → `/dashboard` lists the user's apps and shows a personal **API token**
   (JWT signed with `PLATFORM_API_SECRET`, `lib/tokens.js`).
4. **Deploy** → `POST /api/apps` → `lib/aca.js` calls `@azure/arm-appcontainers`
   `beginCreateOrUpdateAndWait` with a `ManagedIdentityCredential` (or
   `ClientSecretCredential` when an SP is configured). Express rejects a custom
   `revisionSuffix`, so ACA auto-names each revision — every deploy is still a snapshot.
5. **List / status** → `GET /api/apps` queries ARM and filters by the `hackathon-owner` tag.
6. **Rollback** → `POST /api/apps/:name/rollback` reads the target revision's `template`
   and re-applies it as a new active revision.

## API surface (`routes/api.js`)

All routes require a session cookie **or** `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/me` | Identity + platform context; mints API token when session-authenticated. |
| GET | `/api/apps` | List caller's apps (all apps for admins). |
| POST | `/api/apps` | Create/update an app (`name`, `method`, `size`, `image`/`env`…). |
| GET | `/api/apps/:name` | App detail + status + URL. |
| GET | `/api/apps/:name/snapshots` | List revisions (snapshots). |
| POST | `/api/apps/:name/rollback` | Restore a prior revision (`revision` in body). |
| DELETE | `/api/apps/:name` | Delete the app. |

## Ownership & isolation

No database. Every provisioned app is tagged:

- `hackathon-platform: true`
- `hackathon-owner: <user id>` (from the OIDC `sub`)
- `hackathon-app-name`, `hackathon-method`, `hackathon-size`

Listing = an ARM query filtered by `hackathon-owner`. The ARM resource name is
`h<6-char sha256(owner)>-<sanitized name>` (≤ 32 chars), so names never collide across
participants and a user can only see/mutate their own resources (admins in `ADMIN_USERS`
see all).

## Managed identity vs service principal

The platform provisions participant apps as its **own** identity, tagging each app with
`hackathon-owner` for per-user isolation. It authenticates to ARM with a **user-assigned
managed identity** by default, and can fall back to a **service principal**.

This is possible because the control plane runs on a **standard** ACA environment — an
Express app could not carry a managed identity. Participant apps land on Express and don't
need an identity (they're pulled from ACR with admin credentials).

### Managed identity (default)

`infra/modules/provisioner-identity.bicep` creates a **user-assigned identity** and grants
it **Contributor** on the resource group. `platform.bicep` attaches it to the app and sets
`AZURE_CLIENT_ID` (+ `AZURE_USE_MANAGED_IDENTITY=true`), so `lib/aca.js` uses:

```js
const cred = new ManagedIdentityCredential({ clientId: process.env.AZURE_CLIENT_ID });
const client = new ContainerAppsAPIClient(cred, subscriptionId);
```

> The deployer needs rights to create the role assignment (Owner / User Access
> Administrator on the RG). If that's not available, set
> `useManagedIdentityProvisioning=false` and use a service principal instead.

### Service principal (override)

If `AZURE_PROVISION_CLIENT_ID` / `AZURE_PROVISION_CLIENT_SECRET` (+ `AZURE_TENANT_ID`) are
set, they take precedence and `lib/aca.js` uses a `ClientSecretCredential`. The SP is
created by `scripts/create-provisioner-sp.*` with **Contributor** on the RG. Useful in
tenants where you can't create a role assignment but can supply an existing SP.

### Why not true on-behalf-of?

Participants authenticate via **Keycloak**, not Entra ID, so their tokens can't be
exchanged for ARM tokens. The platform therefore provisions as its own identity and
enforces per-user isolation with tags + the `h<hash>-<name>` naming scheme, rather than
impersonating each user against ARM.

## Login (ACA EasyAuth → Keycloak)

Login is handled by the ACA **EasyAuth** feature configured as a **custom OpenID Connect
provider** pointing at Keycloak (`Microsoft.App/containerApps/authConfigs`, see
`platform.bicep`):

- `globalValidation.unauthenticatedClientAction = 'AllowAnonymous'` — the homepage, Skill,
  health checks, and API-token calls stay public; the app gates its own protected routes.
- `/login` → `302 /.auth/login/<provider>?post_login_redirect_uri=/dashboard`. The sidecar
  runs the OIDC code flow and, on success, injects `X-MS-CLIENT-PRINCIPAL*` headers.
- `lib/auth.js#getEasyAuthUser` base64-decodes `X-MS-CLIENT-PRINCIPAL`, maps the
  `preferred_username` / `email` / `name` claims to `{ id, name, email }`.
- `/logout` → `/.auth/logout`.

The Keycloak client's allowed redirect URI is
`https://<platform-fqdn>/.auth/login/<provider>/callback`, registered by the
`postprovision` hook. Set `EASYAUTH_ENABLED=false` to fall back to the app-level
`openid-client` flow (`lib/oidc.js`) for local development.

## Notable Express constraints (design drivers)

- Participant apps: no managed identity, no internal ingress (all apps are public), no KEDA
  custom scale rules, no Dapr/jobs/VNet, `min-replicas` ≤ 2.
- **`revisionSuffix` is not supported on Express**, so `azd deploy` (which sends one) fails
  there — the control-plane apps are hosted on a **standard** env instead.
- Region-locked to **westcentralus** / **eastasia** (preview).
- The Express environment is created with `properties.environmentMode = 'Express'` at api
  version **`2026-03-02-preview`** (the first version whose template schema accepts it) and
  **without** an `appLogsConfiguration` block (Express rejects a literal destination of
  `none`; omitting the block disables app logs).
