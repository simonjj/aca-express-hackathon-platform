#!/usr/bin/env sh
# preprovision hook (POSIX). Generates the platform secrets and writes them into the
# azd environment. No Entra/az-ad calls. Idempotent.
set -eu

key()    { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
secret() { head -c 24 /dev/urandom | base64 | tr -d '+/=\n'; }

CLIENT_ID="${OIDC_CLIENT_ID:-}"
[ -n "$CLIENT_ID" ] || { CLIENT_ID="hackathon-platform"; echo "==> Set OIDC client id."; }

CLIENT_SECRET="${OIDC_CLIENT_SECRET:-}"
[ -n "$CLIENT_SECRET" ] || { CLIENT_SECRET="$(secret)"; echo "==> Generated OIDC client secret."; }

ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-}"
[ -n "$ADMIN_PASS" ] || { ADMIN_PASS="$(secret)"; echo "==> Generated Keycloak admin password."; }

API_SECRET="${PLATFORM_API_SECRET:-}"
[ -n "$API_SECRET" ] || { API_SECRET="$(key)"; echo "==> Generated platform API secret."; }

SESSION_SECRET_V="${SESSION_SECRET:-}"
[ -n "$SESSION_SECRET_V" ] || { SESSION_SECRET_V="$(key)"; echo "==> Generated session secret."; }

azd env set OIDC_CLIENT_ID "$CLIENT_ID" >/dev/null
azd env set OIDC_CLIENT_SECRET "$CLIENT_SECRET" >/dev/null
azd env set KEYCLOAK_ADMIN_PASSWORD "$ADMIN_PASS" >/dev/null
azd env set PLATFORM_API_SECRET "$API_SECRET" >/dev/null
azd env set SESSION_SECRET "$SESSION_SECRET_V" >/dev/null

if [ -z "${AZURE_PROVISION_CLIENT_ID:-}" ]; then
  echo "==> NOTE: no provisioning service principal set. Participant deployments are"
  echo "          DISABLED until you run scripts/create-provisioner-sp.sh (or set"
  echo "          AZURE_PROVISION_* via azd env set)."
fi

echo "==> preprovision complete. Platform secrets ready."
