#!/usr/bin/env bash
set -euo pipefail

rtk docker cp supabase/tests/platform_billing.sql codex-platform-admin-test-20260906:/tmp/platform-admin/tests/platform_billing.sql
rtk docker cp supabase/migrations/20260906170200_platform_billing.sql codex-platform-admin-test-20260906:/tmp/platform-admin/migrations/20260906170200_platform_billing.sql
rtk docker exec codex-platform-admin-test-20260906 psql -U supabase_admin -d codex_platform_admin_test_20260906 -v ON_ERROR_STOP=1 -f /tmp/platform-admin/tests/platform_billing.sql
