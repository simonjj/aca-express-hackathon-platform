# Quickstart

## Prerequisites

- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure CLI (`az`)](https://learn.microsoft.com/cli/azure/install-azure-cli) and `az login`
- Docker (to build the platform image)
- An **Entra-backed** Azure account (ACA Express requires it)
- A subscription with quota in **West Central US** or **East Asia** (the only Express regions)

## 1. Create an environment

```bash
azd env new my-hackathon
```

## 2. Create the provisioning service principal

The platform provisions participant apps with a **service principal**. This script creates
the SP, grants it **Contributor** on the resource group azd will use, and writes
`AZURE_PROVISION_CLIENT_ID` / `AZURE_PROVISION_CLIENT_SECRET` into the azd env.

```bash
pwsh ./scripts/create-provisioner-sp.ps1        # Windows / pwsh
# or
sh   ./scripts/create-provisioner-sp.sh         # bash
```

> **Provisioning is disabled by default.** If you skip this step, the platform still
> deploys and you can log in and browse — the dashboard shows a "provisioning disabled"
> banner until an SP is configured (`azd env set AZURE_PROVISION_*`, then `azd provision`).
> In some tenants `az ad sp create-for-rbac` needs a service-tree reference; see
> [troubleshooting](troubleshooting.md#servicemanagementreference-field-is-required-creating-the-sp).

## 3. Deploy

```bash
azd up
```

- Pick **location**: `westcentralus` or `eastasia`.
- `preprovision` generates the OIDC client secret, Keycloak admin password,
  `PLATFORM_API_SECRET`, and `SESSION_SECRET`.
- `postprovision` configures the Keycloak realm `hackathon`, an OIDC client, and a test
  user.

When it completes, azd prints **PLATFORM_URI** (the homepage) and **KEYCLOAK_URI**.

## 4. Log in and deploy an app

1. Open **PLATFORM_URI**, click **Login**, sign in as `testuser` / `Password123!`.
2. On the dashboard, copy your **API token**.
3. Deploy from the UI, or with the API:

```bash
TOKEN=<paste from dashboard>
BASE=<PLATFORM_URI>

curl -s -X POST "$BASE/api/apps" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"hello","method":"image","image":"mcr.microsoft.com/k8se/quickstart:latest","size":"1cpu2ram"}'
```

4. List and get status:

```bash
curl -s "$BASE/api/apps" -H "Authorization: Bearer $TOKEN"
```

## 5. Snapshots & rollback

Every deploy creates a new revision (snapshot). List and roll back:

```bash
curl -s "$BASE/api/apps/hello/snapshots" -H "Authorization: Bearer $TOKEN"

curl -s -X POST "$BASE/api/apps/hello/rollback" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"revision":"hello--<suffix>"}'
```

## 6. Give the Skill to participants

Point participants' agents at **PLATFORM_URI/skill** (rendered with the live base URL) or
share `skills/aca-hackathon-deploy/SKILL.md`. They only need their personal API token.

## Clean up

```bash
azd down --purge
```
