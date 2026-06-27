#!/usr/bin/env bash
# db-check.sh — acusa divergência entre o histórico de migrations local e o remoto.
# Causa raiz que isto previne: schema aplicado por canais diferentes (CLI vs MCP/painel)
# gera registros com timestamps incompatíveis → histórico divergente. Ver ADR-0043.
#
# Uso:  npm run db:check
# Requer: SUPABASE_ACCESS_TOKEN (lido do .env.local se existir) e projeto linkado.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.local ] && export "$(grep -E '^SUPABASE_ACCESS_TOKEN=' .env.local || true)"

out=$(supabase migration list --linked 2>&1)
# Linha divergente = só um dos lados (local|remote) tem versão.
diverg=$(echo "$out" | awk -F'|' 'NF==3 && /[0-9]/ {
  l=$1; r=$2; gsub(/ /,"",l); gsub(/ /,"",r);
  if (l=="" || r=="") print
}')

if [ -n "$diverg" ]; then
  echo "✗ Migrations DIVERGENTES (local ≠ remoto):"
  echo "$diverg"
  echo ""
  echo "Corrija ANTES de prosseguir. Schema só deve mudar via:"
  echo "  supabase migration new <nome>   &&   supabase db push"
  echo "Nunca aplique DDL por MCP apply_migration ou pelo painel. Ver ADR-0043."
  exit 1
fi
echo "✓ Migrations alinhadas (local = remoto)."
