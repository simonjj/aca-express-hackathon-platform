#!/usr/bin/env sh
# Creates (or reuses) the service principal the platform uses to provision participant
# apps, grants it Contributor on the target resource group, and stores its credentials
# in the azd environment. Run this BEFORE `azd up`.
#
# In tenants that block app-registration credential creation, ask an administrator to
# create the SP and instead run:
#   azd env set AZURE_PROVISION_TENANT_ID    <tenant>
#   azd env set AZURE_PROVISION_CLIENT_ID    <appId>
#   azd env set AZURE_PROVISION_CLIENT_SECRET <secret>
set -eu

NAME="${1:-sp-hackathon-platform-$$}"
RG="${2:-}"

SUB=$(az account show --query id -o tsv)
if [ -z "$RG" ]; then
  ENV_NAME=$(azd env get-value AZURE_ENV_NAME 2>/dev/null || true)
  [ -n "$ENV_NAME" ] || { echo "Pass a resource group name or run 'azd env new' first." >&2; exit 1; }
  RG="rg-$ENV_NAME"
fi

SCOPE="/subscriptions/$SUB/resourceGroups/$RG"
if [ "$(az group exists -n "$RG")" != "true" ]; then
  echo "Resource group not found yet; scoping SP to the subscription instead."
  SCOPE="/subscriptions/$SUB"
fi

echo "Creating service principal '$NAME' with Contributor on $SCOPE ..."
SP=$(az ad sp create-for-rbac --name "$NAME" --role Contributor --scopes "$SCOPE" -o json)

TENANT=$(echo "$SP" | sed -n 's/.*"tenant": *"\([^"]*\)".*/\1/p')
APPID=$(echo "$SP"  | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p')
SECRET=$(echo "$SP" | sed -n 's/.*"password": *"\([^"]*\)".*/\1/p')

azd env set AZURE_PROVISION_TENANT_ID    "$TENANT" >/dev/null
azd env set AZURE_PROVISION_CLIENT_ID    "$APPID"  >/dev/null
azd env set AZURE_PROVISION_CLIENT_SECRET "$SECRET" >/dev/null

echo "Stored AZURE_PROVISION_* in the azd environment."
echo "  tenant : $TENANT"
echo "  appId  : $APPID"
echo "Now run 'azd up' (or 'azd provision')."
