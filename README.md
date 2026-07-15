# ACA Express Hackathon Platform

A one-command [`azd`](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
template that stands up a **hackathon compute platform** on **Azure Container Apps
Express**. Any company can run an AI hackathon where participants from finance, HR,
operations and engineering deploy apps, APIs and static sites into **one shared ACA
Express environment** — using their **AI agent** and a **Skill**, and **without ever
holding Azure credentials**.

```
                         ┌───────────────────────────────────────────────┐
   participant browser ──►  Hackathon Platform  (ACA Express app)         │
                         │  • public HUD homepage (markdown)              │
   AI agent + SKILL  ───►│  • Keycloak OIDC login (app-level)             │
     (Bearer token)      │  • deployment API  ──► ARM (Service Principal) │
                         └───────────────┬───────────────────────────────┘
                                         │ creates / updates / rolls back
                         ┌───────────────▼───────────────────────────────┐
                         │        ONE ACA Express environment             │
                         │   participant apps  ·  Keycloak  ·  registry   │
                         └────────────────────────────────────────────────┘
```

## What you get

- **Public, themed homepage** (HUD "control panel" theme) with organizer instructions in
  **Markdown**, plus one-click staging of the agent **Skill**.
- **Login** via Keycloak (custom OIDC) — swappable for Entra ID (see
  [docs/keycloak-to-entraid.md](docs/keycloak-to-entraid.md)).
- **Dashboard** listing the signed-in user's apps, status, live URLs, and a personal
  **API token** to hand to their agent.
- **Deployment API** to create apps by `name`, `method` (`image` | `container`) and
  replica `size` (`1cpu2ram` | `2cpu4ram` | `4cpu8ram`).
- **Version snapshots + rollback** — every deploy is an ACA revision you can restore.
- **Agent Skill** (`skills/aca-hackathon-deploy/SKILL.md`) so AI agents deploy on the
  user's behalf with just the API token.

## Repository layout

| Path | Purpose |
|------|---------|
| `azure.yaml` | azd service + hooks definition (single `platform` service). |
| `infra/main.bicep` | Subscription-scoped entry point; wires RG, registry, env, Keycloak, platform. |
| `infra/modules/environment.bicep` | ACA **Express** environment (`environmentMode: Express`) + Log Analytics. |
| `infra/modules/registry.bicep` | Shared Azure Container Registry (admin enabled). |
| `infra/modules/keycloak.bicep` | Self-hosted Keycloak OIDC provider. |
| `infra/modules/platform.bicep` | The platform Express app (SP creds, ACR pull, app secrets). |
| `hooks/` | preprovision (generate secrets) + postprovision (configure Keycloak). |
| `src/platform/` | The Express app: UI, deployment API, OIDC, ACA provisioning wrapper. |
| `skills/aca-hackathon-deploy/` | The agent Skill (canonical copy). |
| `scripts/create-provisioner-sp.*` | Helper to create the provisioning service principal. |
| `docs/` | Architecture, quickstart, troubleshooting, Keycloak→Entra switch. |

## Quickstart

Prerequisites: [azd](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd),
Docker, `az login`, and an **Entra-backed** account (ACA Express requires it).
ACA Express preview is available only in **West Central US** and **East Asia**.

```bash
azd env new my-hackathon
# create the provisioning service principal (needs rights to create an app + role assignment):
pwsh ./scripts/create-provisioner-sp.ps1        # or: sh ./scripts/create-provisioner-sp.sh
azd up                                           # pick location: westcentralus or eastasia
```

When it finishes, open the printed **PLATFORM_URI** and sign in with `testuser` /
`Password123!`. Full walkthrough: [docs/quickstart.md](docs/quickstart.md).

## "Can the platform use Managed Identity to provision apps?" — answered

The brief asked us to confirm whether **managed identity (MI)** is a workable, easy way
for the platform to provision apps on users' behalf.

**Finding: No — not for a platform hosted on ACA Express.** Express **does not support
managed identity** (system- or user-assigned) — `az containerapp create --user-assigned`
returns `ExpressEnvironmentFeatureNotSupported`. Express apps also cannot pull from ACR via
MI. So this template uses:

- a **Service Principal client secret** (`@azure/identity` `ClientSecretCredential`) for
  ARM calls (`@azure/arm-appcontainers`), and
- **ACR admin credentials** for image pulls.

If you instead host the **control plane on a standard ACA environment**, MI *is* workable
and easy (UAMI + `Contributor` + `DefaultAzureCredential`). That variant, and the exact
code delta, is documented in [docs/architecture.md](docs/architecture.md#managed-identity-vs-service-principal).

## Docs

- [Architecture](docs/architecture.md) — components, data flow, security, MI vs SP.
- [Quickstart](docs/quickstart.md) — deploy, log in, deploy an app, roll back.
- [Troubleshooting](docs/troubleshooting.md) — common failures and fixes.
- [Keycloak → Entra ID](docs/keycloak-to-entraid.md) — switch the identity provider.

## Local development

```bash
cd src/platform
npm install
PORT=8099 node server.js       # homepage + skill work with no Azure wiring
```

Login and provisioning are disabled locally unless you set the corresponding env vars
(`OIDC_*`, `AZURE_PROVISION_*`); the app degrades gracefully.
