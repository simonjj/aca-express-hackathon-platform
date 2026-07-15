---
name: aca-hackathon-deploy
description: Deploy and manage applications on the ACA Express Hackathon Platform. Use this skill whenever the user wants to deploy an app/API/static site to the hackathon, list their apps, check status, view version snapshots, or roll back to a previous version. The platform runs on Azure Container Apps Express; participants never need Azure credentials — only their personal platform API token.
---

# ACA Express Hackathon Platform — Deploy Skill

> This is the canonical copy. The **live** copy — pre-filled with your deployment's URL —
> is downloadable from the running platform at `<PLATFORM_URL>/skill/SKILL.md`. Prefer that
> one; it has working endpoints baked in.

This skill lets you (an AI agent) deploy the user's application to the shared
**Azure Container Apps Express** hackathon environment on their behalf. The user does
**not** need Azure credentials — only their personal **API token** from the platform.

- **Platform:** `<PLATFORM_URL>` (e.g. `https://ca-platform-xxxx.<region>.azurecontainerapps.io`)
- **API base:** `<PLATFORM_URL>/api`
- **Auth:** every `/api` request needs `Authorization: Bearer <PLATFORM_API_TOKEN>`

## 1. Get the API token (one time)

Ask the user to sign in at the platform, open the **Dashboard**, and copy their **API token**.

```bash
export PLATFORM_URL="https://<your-platform-url>"
export PLATFORM_API_TOKEN="<paste-token-here>"
curl -s -H "Authorization: Bearer $PLATFORM_API_TOKEN" "$PLATFORM_URL/api/me"
```

## 2. Deploy an application

`POST /api/apps` — creates (or updates) an app and returns its public URL. Each call
becomes a new **version snapshot** you can roll back to later.

| Field        | Required | Values |
|--------------|----------|--------|
| `name`       | yes      | Friendly app name (letters/numbers/dashes). |
| `method`     | yes      | `image` (pre-defined/public image) or `container` (image you pushed to the platform registry). |
| `image`      | yes      | Full image reference, e.g. `ghcr.io/acme/site:latest`. |
| `size`       | no       | `1cpu2ram`, `2cpu4ram`, or `4cpu8ram`. |
| `targetPort` | no       | Port your container listens on (default `80`). |
| `env`        | no       | Object of environment variables. |

```bash
curl -s -X POST "$PLATFORM_URL/api/apps" \
  -H "Authorization: Bearer $PLATFORM_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-demo",
    "method": "image",
    "image": "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest",
    "size": "1cpu2ram",
    "targetPort": 80
  }'
```

The response includes `url` — the live address. Deployment takes ~1–2 minutes; poll
`GET /api/apps/<name>` until `status` is running.

### The `container` method

Push your own image to the platform registry (shown on the Dashboard as
`<registry>.azurecr.io`), then deploy with `method: "container"` and that reference.
Public images use `method: "image"`.

## 3. List / status

```bash
curl -s -H "Authorization: Bearer $PLATFORM_API_TOKEN" "$PLATFORM_URL/api/apps"
curl -s -H "Authorization: Bearer $PLATFORM_API_TOKEN" "$PLATFORM_URL/api/apps/<name>"
```

## 4. Iterate (snapshots)

Re-deploy the same `name` with a new `image` to ship a change; the previous version is
retained as a snapshot.

```bash
curl -s -H "Authorization: Bearer $PLATFORM_API_TOKEN" "$PLATFORM_URL/api/apps/<name>/snapshots"
```

## 5. Roll back

```bash
curl -s -X POST "$PLATFORM_URL/api/apps/<name>/rollback" \
  -H "Authorization: Bearer $PLATFORM_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"revision": "<revision-name-from-snapshots>"}'
```

## 6. Delete

```bash
curl -s -X DELETE "$PLATFORM_URL/api/apps/<name>" -H "Authorization: Bearer $PLATFORM_API_TOKEN"
```

## Guidance for the agent

- Always confirm the deployed `url` back to the user.
- Choose the smallest size that fits; escalate only if needed.
- Static sites: containerize with any static file server (e.g. `nginx`) on your `targetPort`.
- On `503 provisioning disabled`, tell the user the operator hasn't configured a
  provisioning service principal yet.
- Never ask the user for Azure credentials — the platform token is all you need.
