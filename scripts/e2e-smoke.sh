#!/usr/bin/env bash
set -euo pipefail

base_url="${TCP_E2E_BASE_URL:-http://localhost:18081}"
backend_url="${TCP_E2E_BACKEND_URL:-http://localhost:18001}"
year="${TCP_E2E_YEAR:-$(date +%Y)}"
demo_password="${TCP_E2E_DEMO_PASSWORD:-}"
if [[ -z "$demo_password" ]]; then
  echo "Set TCP_E2E_DEMO_PASSWORD to the DEMO_SEED_PASSWORD used when the stack was seeded" >&2
  exit 1
fi
cookies="$(mktemp)"
trap 'rm -f "$cookies"' EXIT

assert_json() {
  local condition="$1"
  python3 -c "import json, sys; payload = json.load(sys.stdin); assert $condition"
}

wait_for_http() {
  local url="$1"
  for _ in {1..30}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

if [[ "${TCP_E2E_RESTART:-0}" == "1" ]]; then
  docker compose restart backend frontend
fi

wait_for_http "$backend_url/ready"
wait_for_http "$base_url/api/capability-model"
curl -fsS "$backend_url/ready" | assert_json "payload['status'] == 'ready'"
curl -fsS "$base_url/api/capability-model" | assert_json "len(payload['domains']) == 6"

curl -fsS -c "$cookies" -X POST "$base_url/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"member\",\"password\":\"$demo_password\"}" | \
  assert_json "payload['username'] == 'member' and 'Member' in payload['roles']"
curl -fsS -b "$cookies" "$base_url/api/auth/me" | \
  assert_json "payload['username'] == 'member'"
curl -fsS -b "$cookies" "$base_url/api/planning/profiles?year=$year" | \
  assert_json "payload['member']['username'] == 'member' and payload['assessments'] and payload['annual_plan'] is not None and payload['statistics']['total_learning_hours'] >= 0"
curl -fsS -b "$cookies" -X POST "$base_url/api/auth/logout" | \
  assert_json "payload['ok'] is True"

echo "PASS: TCP end-to-end smoke ($year)"
