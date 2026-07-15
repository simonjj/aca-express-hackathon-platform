'use strict';

// Generates the agent SKILL as Markdown, injecting the live platform base URL so a
// participant who downloads it from their own deployment gets working, copy-pasteable
// commands. Kept in sync with skills/aca-hackathon-deploy/SKILL.md (the repo copy).

function renderSkill(baseUrl, defaultSize = '1cpu2ram') {
  const url = (baseUrl || 'https://<your-platform-url>').replace(/\/$/, '');
  return `---
name: aca-hackathon-deploy
description: Deploy and manage applications on the ACA Express Hackathon Platform. Use this skill whenever the user wants to deploy an app/API/static site to the hackathon, list their apps, check status, view version snapshots, or roll back to a previous version. The platform runs on Azure Container Apps Express; participants never need Azure credentials — only their personal platform API token.
---

# ACA Express Hackathon Platform — Deploy Skill

This skill lets you (an AI agent) deploy the user's application to the shared
**Azure Container Apps Express** hackathon environment on their behalf. The user does
**not** need Azure credentials. They authenticate to the platform with their personal
**API token** and you call a small REST API.

- **Platform:** ${url}
- **API base:** ${url}/api
- **Auth:** every \`/api\` request needs \`Authorization: Bearer <PLATFORM_API_TOKEN>\`

## 1. Get the API token (one time)

Ask the user to sign in at **${url}**, open the dashboard, and copy their
**API token** (shown under "Your API token"). Store it as an environment variable:

\`\`\`bash
export PLATFORM_API_TOKEN="<paste-token-here>"
export PLATFORM_URL="${url}"
\`\`\`

Verify it:

\`\`\`bash
curl -s -H "Authorization: Bearer $PLATFORM_API_TOKEN" "$PLATFORM_URL/api/me"
\`\`\`

## 2. Deploy an application

\`POST /api/apps\` — creates (or updates) an app and returns its public URL. Each call
becomes a new **version snapshot** you can roll back to later.

Body fields:

| Field       | Required | Values                                                        |
|-------------|----------|---------------------------------------------------------------|
| \`name\`      | yes      | Friendly app name (letters/numbers/dashes).                    |
| \`method\`    | yes      | \`image\` (a pre-defined/public image) or \`container\` (an image you pushed to the platform registry). |
| \`image\`     | yes      | Full image reference, e.g. \`ghcr.io/acme/site:latest\`.        |
| \`size\`      | no       | \`1cpu2ram\`, \`2cpu4ram\`, or \`4cpu8ram\` (default \`${defaultSize}\`).|
| \`targetPort\`| no       | Port your container listens on (default \`80\`).               |
| \`env\`       | no       | Object of environment variables, e.g. \`{"KEY":"value"}\`.     |

\`\`\`bash
curl -s -X POST "$PLATFORM_URL/api/apps" \\
  -H "Authorization: Bearer $PLATFORM_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "my-demo",
    "method": "image",
    "image": "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest",
    "size": "1cpu2ram",
    "targetPort": 80
  }'
\`\`\`

The response includes \`url\` — the live public address of the deployed app. Deployment
takes ~1-2 minutes; poll status with \`GET /api/apps/<name>\` until \`status\` is running.

### The \`container\` method

To deploy your own build, push the image to the platform registry first (the platform
prints its registry login server on the dashboard), then deploy with \`method: "container"\`
and the \`<registry>.azurecr.io/<repo>:<tag>\` reference. Public images use \`method: "image"\`.

## 3. List your apps and check status

\`\`\`bash
curl -s -H "Authorization: Bearer $PLATFORM_API_TOKEN" "$PLATFORM_URL/api/apps"
curl -s -H "Authorization: Bearer $PLATFORM_API_TOKEN" "$PLATFORM_URL/api/apps/<name>"
\`\`\`

## 4. Iterate — every deploy is snapshotted

Re-deploy the same \`name\` with a new \`image\` to ship a change. The previous version is
retained as a snapshot (revision). List snapshots:

\`\`\`bash
curl -s -H "Authorization: Bearer $PLATFORM_API_TOKEN" "$PLATFORM_URL/api/apps/<name>/snapshots"
\`\`\`

## 5. Roll back

\`\`\`bash
curl -s -X POST "$PLATFORM_URL/api/apps/<name>/rollback" \\
  -H "Authorization: Bearer $PLATFORM_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"revision": "<revision-name-from-snapshots>"}'
\`\`\`

## 6. Delete

\`\`\`bash
curl -s -X DELETE "$PLATFORM_URL/api/apps/<name>" -H "Authorization: Bearer $PLATFORM_API_TOKEN"
\`\`\`

## Guidance for the agent

- Always confirm the deployed \`url\` back to the user and offer to open it.
- Choose the smallest size that fits; escalate only if the app needs more memory/CPU.
- Static sites: containerize with any static file server (e.g. \`nginx\`) listening on the
  \`targetPort\` you pass.
- On a \`503 provisioning disabled\` error, tell the user the platform operator has not
  configured a provisioning service principal yet.
- Never ask the user for Azure credentials — the platform token is all you need.
`;
}

module.exports = { renderSkill };
