#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$script_dir/../e2e-smoke.sh"

[[ -x "$script" ]]
for endpoint in \
  '/ready' \
  '/api/capability-model' \
  '/api/auth/login' \
  '/api/auth/me' \
  '/api/planning/profiles'; do
  grep -Fq "$endpoint" "$script"
done
grep -Fq 'TCP_E2E_RESTART' "$script"
grep -Fq 'json_body()' "$script"

# Non-network regression: the login body must be JSON-encoded so quotes,
# backslashes, whitespace, and Unicode cannot alter the payload shape.
# shellcheck disable=SC1090
source <(sed -n '/^json_body() {/,/^}/p' "$script")

special_password=$'p"w\\d \t你 好'
body="$(json_body "$special_password")"

python3 - "$special_password" "$body" <<'PYEOF'
import json, sys
expected, body = sys.argv[1], sys.argv[2]
assert json.loads(body) == {"username": "member", "password": expected}
assert "\n" not in body  # single-line body cannot smuggle extra payload
assert 'p"' not in body  # no unescaped quote
print("PASS: login body encodes special characters safely")
PYEOF

echo "PASS: e2e smoke covers readiness, anonymous catalog, session, profile, and JSON-safe login body"
