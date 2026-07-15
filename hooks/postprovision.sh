#!/usr/bin/env sh
# postprovision hook (POSIX): configure the Keycloak stand-in IdP for the platform's
# app-level OIDC login. Requires curl. Values come from azd outputs.
set -eu

: "${KEYCLOAK_URI:?run via azd provision/up}"
: "${KEYCLOAK_ADMIN_USERNAME:?}"
: "${KEYCLOAK_ADMIN_PASSWORD:?}"
: "${OIDC_REALM:?}"
: "${OIDC_CLIENT_ID:?}"
: "${OIDC_CLIENT_SECRET:?}"
: "${PLATFORM_REDIRECT_URI:?}"
: "${PLATFORM_URI:?}"

WEB_URI="${PLATFORM_URI}"
TEST_USER="testuser"
TEST_PASS="Password123!"

echo "Configuring Keycloak at ${KEYCLOAK_URI} (realm '${OIDC_REALM}', client '${OIDC_CLIENT_ID}')"

# 1. Wait for readiness
ready=""
i=1
while [ "$i" -le 60 ]; do
  if curl -fsS "${KEYCLOAK_URI}/realms/master/.well-known/openid-configuration" >/dev/null 2>&1; then
    ready="yes"; break
  fi
  echo "  waiting for Keycloak to start... ($i/60)"
  sleep 10
  i=$((i+1))
done
[ -n "$ready" ] || { echo "Keycloak did not become ready" >&2; exit 1; }
echo "Keycloak is up."

# 2. Admin token
TOKEN=$(curl -fsS -X POST \
  "${KEYCLOAK_URI}/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password" -d "client_id=admin-cli" \
  --data-urlencode "username=${KEYCLOAK_ADMIN_USERNAME}" \
  --data-urlencode "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "Failed to obtain admin token" >&2; exit 1; }

AB="${KEYCLOAK_URI}/admin/realms"
AUTH="Authorization: Bearer ${TOKEN}"

# 3. Realm (create if missing)
if curl -fsS -H "$AUTH" "${AB}/${OIDC_REALM}" >/dev/null 2>&1; then
  echo "Realm '${OIDC_REALM}' already exists."
else
  echo "Creating realm '${OIDC_REALM}'..."
  curl -fsS -X POST -H "$AUTH" -H "Content-Type: application/json" "${AB}" \
    -d "{\"realm\":\"${OIDC_REALM}\",\"enabled\":true,\"sslRequired\":\"external\",\"registrationAllowed\":false,\"loginWithEmailAllowed\":true}" >/dev/null
fi

CLIENT_JSON=$(cat <<EOF
{
  "clientId": "${OIDC_CLIENT_ID}",
  "protocol": "openid-connect",
  "publicClient": false,
  "clientAuthenticatorType": "client-secret",
  "secret": "${OIDC_CLIENT_SECRET}",
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": false,
  "redirectUris": ["${PLATFORM_REDIRECT_URI}", "${WEB_URI}/auth/*", "${WEB_URI}/*"],
  "webOrigins": ["${WEB_URI}"],
  "attributes": { "post.logout.redirect.uris": "${WEB_URI}/*" }
}
EOF
)

# 4. Client (create or update)
UUID=$(curl -fsS -H "$AUTH" "${AB}/${OIDC_REALM}/clients?clientId=${OIDC_CLIENT_ID}" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -n1)
if [ -n "$UUID" ]; then
  echo "Updating existing client '${OIDC_CLIENT_ID}' (${UUID})..."
  curl -fsS -X PUT -H "$AUTH" -H "Content-Type: application/json" \
    "${AB}/${OIDC_REALM}/clients/${UUID}" -d "$CLIENT_JSON" >/dev/null
else
  echo "Creating client '${OIDC_CLIENT_ID}'..."
  curl -fsS -X POST -H "$AUTH" -H "Content-Type: application/json" \
    "${AB}/${OIDC_REALM}/clients" -d "$CLIENT_JSON" >/dev/null
fi

USER_JSON=$(cat <<EOF
{
  "username": "${TEST_USER}",
  "enabled": true,
  "emailVerified": true,
  "email": "testuser@example.com",
  "firstName": "Test",
  "lastName": "User",
  "credentials": [{ "type": "password", "value": "${TEST_PASS}", "temporary": false }]
}
EOF
)

# 5. Test user (create or update)
UID_=$(curl -fsS -H "$AUTH" "${AB}/${OIDC_REALM}/users?username=${TEST_USER}&exact=true" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -n1)
if [ -n "$UID_" ]; then
  echo "Updating existing user '${TEST_USER}' (${UID_})..."
  curl -fsS -X PUT -H "$AUTH" -H "Content-Type: application/json" \
    "${AB}/${OIDC_REALM}/users/${UID_}" -d "$USER_JSON" >/dev/null
else
  echo "Creating user '${TEST_USER}'..."
  curl -fsS -X POST -H "$AUTH" -H "Content-Type: application/json" \
    "${AB}/${OIDC_REALM}/users" -d "$USER_JSON" >/dev/null
fi

echo ""
echo "Keycloak configured successfully."
echo "  Platform   : ${WEB_URI}"
echo "  Login with : ${TEST_USER} / ${TEST_PASS}"
echo ""
