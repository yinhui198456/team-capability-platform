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

# Static assertions: the password must travel to the encoder on stdin, never
# in the python3 argv (process listings / shell history exposure).
grep -Fq '| python3 -c' "$script"
grep -Fq 'sys.stdin.read()' "$script"
if grep -E 'python3 -c.*"\$1"' "$script"; then
  echo "FAIL: json_body transports the password via argv" >&2
  exit 1
fi

# Non-network regression: the login body must be JSON-encoded so quotes,
# backslashes, whitespace, tabs, newlines, and Unicode cannot alter the
# payload shape, and the exact raw value must survive the round trip.
# shellcheck disable=SC1090
source <(sed -n '/^json_body() {/,/^}/p' "$script")

special_password=$'  p"w\\d \t\n你 好  '
body="$(json_body "$special_password")"

python3 - "$special_password" "$body" <<'PYEOF'
import json, sys
expected, body = sys.argv[1], sys.argv[2]
assert json.loads(body) == {"username": "member", "password": expected}
assert "\n" not in body  # single-line body cannot smuggle extra payload
assert 'p"' not in body  # no unescaped quote
print("PASS: login body encodes special characters safely and preserves the exact value")
PYEOF

echo "PASS: e2e smoke covers readiness, anonymous catalog, session, profile, and JSON-safe login body"
