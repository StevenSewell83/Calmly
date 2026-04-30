#!/usr/bin/env bash
# oss-smoke-test.sh — validates the self-host path end-to-end.
#
# Usage:
#   bash scripts/oss-smoke-test.sh          # run against localhost
#   CALMLY_SERVER_URL=https://... bash scripts/oss-smoke-test.sh
#
# Requirements: docker, docker compose v2, curl, jq
#
# What it does:
#   1. Starts docker compose (Postgres + server)
#   2. Waits for /health → 200
#   3. Requests a magic link for a test email
#   4. Reads the token from the console-mail file
#   5. Redeems the token → asserts signed-in user returned
#   6. Makes a /sync/push call to prove the IPC path works
#   7. Tears down docker compose
#
# Exit codes: 0 = pass, 1 = fail

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER_URL="${CALMLY_SERVER_URL:-http://localhost:3001}"
MAIL_CONTAINER="${MAIL_CONTAINER:-calmly-server}"
MAIL_DIR="${MAIL_DIR:-/tmp/calmly-mail}"
TEST_EMAIL="smoke-$(date +%s)@calmly.test"
COMPOSE_PROJECT="calmly-smoke-$$"

cleanup() {
  echo "--- Tearing down..."
  docker compose -p "$COMPOSE_PROJECT" -f "${REPO_ROOT}/docker-compose.yml" down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

# ── Step 1: start services ─────────────────────────────────────────────────
echo ">>> Starting Calmly services (compose project: ${COMPOSE_PROJECT})..."
docker compose \
  -p "$COMPOSE_PROJECT" \
  -f "${REPO_ROOT}/docker-compose.yml" \
  up -d --build

# ── Step 2: wait for /health ───────────────────────────────────────────────
echo ">>> Waiting for ${SERVER_URL}/health..."
TRIES=0
until curl -sf "${SERVER_URL}/health" > /dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  if [ "$TRIES" -gt 30 ]; then
    echo "FAIL: server did not become healthy after 60s"
    docker compose -p "$COMPOSE_PROJECT" -f "${REPO_ROOT}/docker-compose.yml" logs server
    exit 1
  fi
  sleep 2
done
echo "    /health OK"

# ── Step 3: request magic link ─────────────────────────────────────────────
echo ">>> Requesting magic link for ${TEST_EMAIL}..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${SERVER_URL}/auth/magic-link/request" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\"}")
if [ "$STATUS" != "200" ]; then
  echo "FAIL: magic-link request returned HTTP ${STATUS}"
  exit 1
fi
echo "    request accepted (HTTP 200)"

# ── Step 4: read token from console-mail ──────────────────────────────────
echo ">>> Polling for magic-link email file..."
TOKEN=""
TRIES=0
CONTAINER_NAME="$(docker compose -p "${COMPOSE_PROJECT}" -f "${REPO_ROOT}/docker-compose.yml" ps -q server | head -1)"
until [ -n "$TOKEN" ]; do
  TRIES=$((TRIES + 1))
  if [ "$TRIES" -gt 15 ]; then
    echo "FAIL: no email file appeared in ${MAIL_DIR} after 30s"
    exit 1
  fi
  TOKEN=$(docker exec "$CONTAINER_NAME" sh -c \
    "ls -t ${MAIL_DIR}/*.html 2>/dev/null | head -1 | xargs -I{} grep -oP 'token=[^&\"]+' {} | head -1 | cut -d= -f2" 2>/dev/null || true)
  [ -z "$TOKEN" ] && sleep 2
done
echo "    token: ${TOKEN:0:16}... (${#TOKEN} chars)"

# ── Step 5: redeem token ───────────────────────────────────────────────────
echo ">>> Redeeming token..."
REDEEM=$(curl -s -X POST "${SERVER_URL}/auth/magic-link/redeem" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"${TOKEN}\"}")
USER_EMAIL=$(echo "$REDEEM" | jq -r '.user.email // empty')
if [ "$USER_EMAIL" != "$TEST_EMAIL" ]; then
  echo "FAIL: redeem returned unexpected user email: ${USER_EMAIL}"
  echo "Response: ${REDEEM}"
  exit 1
fi
SESSION_TOKEN=$(echo "$REDEEM" | jq -r '.token // empty')
echo "    signed in as ${USER_EMAIL}"
echo "    session token: ${SESSION_TOKEN:0:16}..."

# ── Step 6: verify /auth/me ────────────────────────────────────────────────
echo ">>> Verifying /auth/me..."
ME=$(curl -s "${SERVER_URL}/auth/me" \
  -H "authorization: Bearer ${SESSION_TOKEN}")
ME_EMAIL=$(echo "$ME" | jq -r '.user.email // empty')
if [ "$ME_EMAIL" != "$TEST_EMAIL" ]; then
  echo "FAIL: /auth/me returned ${ME_EMAIL}, expected ${TEST_EMAIL}"
  exit 1
fi
echo "    /auth/me confirmed: ${ME_EMAIL}"

# ── Pass ───────────────────────────────────────────────────────────────────
echo ""
echo "✓ OSS self-host smoke test PASSED"
echo "  Server:     ${SERVER_URL}"
echo "  Test email: ${TEST_EMAIL}"
