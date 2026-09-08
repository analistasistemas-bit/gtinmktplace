#!/usr/bin/env bash
# scripts/supabase.sh — wrapper da Supabase CLI compatível com o sandbox do DSH.
# Carrega automaticamente o SUPABASE_ACCESS_TOKEN do .env.local e redireciona HOME=/tmp.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  token=$(grep -E '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2- || true)
  if [ -n "$token" ]; then
    export SUPABASE_ACCESS_TOKEN="$token"
  fi
fi

if [ -n "${DSH_SHELL:-}" ]; then
  export HOME=/tmp
  export XDG_CONFIG_HOME=/tmp
fi

exec supabase "$@"
