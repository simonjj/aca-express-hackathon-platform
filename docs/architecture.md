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
| Platform app | `infra/modules/platform.bicep` | Runs on the standard env; external ingress, SP + OIDC + secret env, min 1 / max 2 replicas. |

## Request / data flow

1. **Browse** → `/` renders `content/homepage.md` (or `HOMEPAGE_MARKDOWN`) in the HUD theme.
2. **Login** → `/login` starts OIDC Authorization Code + PKCE (`lib/oidc.js`, `openid-client`
   v5). `/auth/callback` establishes a signed `cookie-session`.
3. **Dashboard** → `/dashboard` lists the user's apps and shows a personal **API token**
   (JWT signed with `PLATFORM_API_SECRET`, `lib/tokens.js`).
4. **Deploy** → `POST /api/apps` → `lib/aca.js` calls `@azure/arm-appcontainers`
   `beginCreateOrUpdateAndWait` with a `ClientSecretCredential`. Each deploy uses a fresh
   `revisionSuffix` = a snapshot.
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

**Why a Service Principal (not managed identity)?** The platform app now runs on a
**standard** environment, so managed identity *would* work. The template ships with a
**Service Principal client secret** because it works regardless of host, needs no UAMI
wiring, and keeps ARM auth + ACR pulls uniform. The platform authenticates to ARM with the
SP and pulls images with **ACR admin credentials**.

> Note: participant apps themselves land on **Express**, which does **not** support managed
> identity (`ExpressEnvironmentFeatureNotSupported`) — but that doesn't affect how the
> *control plane* authenticates.

`lib/aca.js`:

```js
const cred = new ClientSecretCredential(tenantId, clientId, clientSecret);
const client = new ContainerAppsAPIClient(cred, subscriptionId);
```

The SP is created by `scripts/create-provisioner-sp.*` with **Contributor** on the target
resource group and stored as `AZURE_PROVISION_CLIENT_ID` / `AZURE_PROVISION_CLIENT_SECRET`
in the azd environment (surfaced to the app as secrets).

**To switch the control plane to managed identity** (it runs on a standard env, so this is
easy):

1. Give the platform app a **user-assigned identity** with `Contributor` on the RG.
2. Swap the credential:
   ```js
   const cred = new DefaultAzureCredential();   // uses the app's UAMI
   ```
3. Enable ACR pull via the same UAMI (`az containerapp registry set --identity`) and drop
   the ACR admin username/password.

Everything else (API, snapshots, tags, UI) is identical.

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
