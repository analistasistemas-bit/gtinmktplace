#!/usr/bin/env bash
set -euo pipefail

container="${1:-codex-platform-admin-test-20260906}"
database="${2:-codex_platform_admin_test_20260906}"
if [[ "$container" != "codex-platform-admin-test-20260906" || "$database" != "codex_platform_admin_test_20260906" ]]; then
  echo "refusing to run outside the dedicated local fixture" >&2
  exit 2
fi
rtk docker exec "$container" psql -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -f /tmp/platform-admin/tests/platform_sonar.sql
