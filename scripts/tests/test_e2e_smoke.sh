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

echo "PASS: e2e smoke covers readiness, anonymous catalog, session, and profile"
