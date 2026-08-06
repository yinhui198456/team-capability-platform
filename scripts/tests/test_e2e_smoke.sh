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

# Static assertions: the login body must reach curl on stdin (--data-binary
# @-), never as a -d "$(json_body ...)" substitution that lands in the curl
# argv (process listings on a shared host).
if grep -E -- '-d "\$\(json_body' "$script"; then
  echo "FAIL: login body is substituted into curl argv via -d" >&2
  exit 1
fi
grep -Fq -- '--data-binary @-' "$script"

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

# Dynamic transport regression: run the real script against a fake curl and
# python3 that record every argv line and the login request body. A
# distinctive synthetic credential must arrive in the login request body
# exactly, and must never appear in any observed curl or python3 argv.
fake_bin="$(mktemp -d)"
record_dir="$(mktemp -d)"
trap 'rm -rf "$fake_bin" "$record_dir"' EXIT

cat > "$fake_bin/curl" <<'STUB'
#!/usr/bin/env bash
printf 'curl|%s\n' "$*" >> "$STUB_RECORD"
prev=""
for arg in "$@"; do
  if [[ "$prev" == "-c" ]]; then
    : > "$arg"
  fi
  prev="$arg"
done
case "$*" in
  *"--data-binary @-"* | *"-d @-"*) cat > "$STUB_BODY" ;;
esac
case "$*" in
  *"/ready"*) echo '{"status": "ready"}' ;;
  *"/api/capability-model"*) echo '{"domains": [{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}, {"id": 5}, {"id": 6}]}' ;;
  *"/api/auth/login"*) echo '{"username": "member", "roles": ["Member"]}' ;;
  *"/api/auth/me"*) echo '{"username": "member"}' ;;
  *"/api/planning/profiles"*) echo '{"member": {"username": "member"}, "assessments": [1], "annual_plan": {}, "statistics": {"total_learning_hours": 4}}' ;;
  *"/api/auth/logout"*) echo '{"ok": true}' ;;
esac
STUB

cat > "$fake_bin/python3" <<'STUB'
#!/usr/bin/env bash
printf 'python3|%s\n' "$*" >> "$STUB_RECORD"
exec /usr/bin/python3 "$@"
STUB
chmod +x "$fake_bin/curl" "$fake_bin/python3"

# Distinctive synthetic value; never a real environment credential. The
# marker substring survives JSON encoding verbatim, so its absence from the
# recorded argv proves no observed process saw the credential in any form.
fake_password=$'  FAKE-E2E-CRED p"w\\d \t\n你 好  '

if ! PATH="$fake_bin:$PATH" STUB_RECORD="$record_dir/argv.log" \
  STUB_BODY="$record_dir/login-body.json" \
  TCP_E2E_DEMO_PASSWORD="$fake_password" \
  TCP_E2E_BASE_URL="http://127.0.0.1:9" TCP_E2E_BACKEND_URL="http://127.0.0.1:9" \
  bash "$script" >/dev/null; then
  echo "FAIL: e2e smoke did not pass with stubbed transports" >&2
  exit 1
fi

/usr/bin/python3 - "$fake_password" "$record_dir/argv.log" "$record_dir/login-body.json" <<'PYEOF'
import json
import sys

expected, argv_path, body_path = sys.argv[1], sys.argv[2], sys.argv[3]
marker = "FAKE-E2E-CRED"
with open(argv_path) as f:
    argv = f.read()
if marker in argv:
    print("FAIL: credential appeared in curl/python3 argv", file=sys.stderr)
    sys.exit(1)
try:
    with open(body_path) as f:
        body = f.read()
except FileNotFoundError:
    print("FAIL: no login request body recorded (body must reach curl via stdin)", file=sys.stderr)
    sys.exit(1)
if json.loads(body) != {"username": "member", "password": expected}:
    print("FAIL: login body does not carry the exact raw credential", file=sys.stderr)
    sys.exit(1)
print("PASS: fake credential reaches the login body exactly and never appears in curl/python3 argv")
PYEOF

echo "PASS: e2e smoke covers readiness, anonymous catalog, session, profile, JSON-safe login body, and argv-free credential transport"
