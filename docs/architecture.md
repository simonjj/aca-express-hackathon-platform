# Architecture

## Overview

The platform is a single **Node/Express** app running on **Azure Container Apps
Express**. It serves the public homepage, handles OIDC login, exposes a deployment API,
and provisions participant apps into the **same** ACA Express environment via ARM.

```
 ┌──────────────────────────── ACA Express environment ─────────────────────────────┐
 │                                                                                   │
 │   ┌───────────────┐        ┌───────────────┐         ┌──────────────────────┐     │
 │   │  Keycloak     │  OIDC  │  Platform app │   ARM   │ participant apps      │     │
 │   │  (OIDC IdP)   │◄──────►│  (this repo)  │────────►│  h<hash>-<name> ...   │     │
 │   └───────────────┘        └──────┬────────┘  SP     └──────────────────────┘     │
 │                                   │ pull                                          │
 │                                   ▼                                               │
 │                          ┌──────────────┐                                         │
 │                          │  ACR (admin) │◄─ images pushed/pulled                  │
 │                          └──────────────┘                                         │
 └───────────────────────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Module | Notes |
|-----------|--------|-------|
| ACA Express environment | `infra/modules/environment.bicep` | `environmentMode: 'Express'` (BCP037 suppressed) + Log Analytics. |
| Container registry | `infra/modules/registry.bicep` | `adminUserEnabled: true` — Express can't pull with MI. |
| Keycloak | `infra/modules/keycloak.bicep` | Self-hosted OIDC provider, public ingress. |
| Platform app | `infra/modules/platform.bicep` | External ingress, SP + OIDC + secret env, min 1 / max 2 replicas. |

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

**Why not managed identity?** ACA **Express** does not support managed identity — both
system- and user-assigned MI return `ExpressEnvironmentFeatureNotSupported`, and Express
apps cannot pull from ACR using MI. So the platform authenticates to ARM with a
**Service Principal client secret** and pulls images with **ACR admin credentials**.

`lib/aca.js`:

```js
const cred = new ClientSecretCredential(tenantId, clientId, clientSecret);
const client = new ContainerAppsAPIClient(cred, subscriptionId);
```

The SP is created by `scripts/create-provisioner-sp.*` with **Contributor** on the target
resource group and stored as `AZURE_PROVISION_CLIENT_ID` / `AZURE_PROVISION_CLIENT_SECRET`
in the azd environment (surfaced to the app as secrets).

**If you host the control plane on a *standard* (non-Express) ACA environment**, MI is the
easier path:

1. Give the platform app a **user-assigned identity** with `Contributor` on the RG.
2. Swap the credential:
   ```js
   const cred = new DefaultAzureCredential();   // uses the app's UAMI
   ```
3. Enable ACR pull via the same UAMI (`az containerapp registry set --identity`) and drop
   the ACR admin username/password.

Everything else (API, snapshots, tags, UI) is identical. Only participant apps must remain
on Express if you need the Express economics; the control plane can live anywhere.

## Notable Express constraints (design drivers)

- No managed identity, no internal ingress (all apps are public), no KEDA custom scale
  rules, no Dapr/jobs/VNet.
- Region-locked to **westcentralus** / **eastasia** (preview).
- `min-replicas` ≤ 2. Environment created with `properties.environmentMode = 'Express'`.
