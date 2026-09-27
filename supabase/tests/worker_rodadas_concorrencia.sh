#!/usr/bin/env bash
# ADR-0173 caso 1: duas aberturas concorrentes da mesma (job, org). A sessão A abre e segura a
# transação; a B tem de ESPERAR o lock e, após o commit de A, receber 'ocupada'. Duas variantes:
# linha já existente e linha ainda inexistente (disputa do INSERT).
# Uso: bash supabase/tests/worker_rodadas_concorrencia.sh [container]  (Postgres LOCAL, nunca remoto)
set -euo pipefail
C="${1:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
ORG=95000000-0000-0000-0000-0000000000c1
psql_() { docker exec -i -e PGPASSWORD=postgres "$C" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

psql_ -c "insert into public.organizations (id, nome, slug) values ('$ORG', 'Rodadas conc', 'rodadas-conc') on conflict do nothing"
trap 'psql_ -c "delete from public.organizations where id = '"'$ORG'"'"' EXIT

variante() {
  local nome="$1"
  # A: abre e segura 3 s sem commit.
  psql_ -c "begin; select resultado from public.abrir_execucao('backfill', '$ORG', '2026-09-27', '{}'); select pg_sleep(3); commit;" > /tmp/wr_conc_a.out &
  local pid=$!
  sleep 1
  local t0; t0=$(date +%s)
  local b; b=$(psql_ -c "select resultado from public.abrir_execucao('backfill', '$ORG', '2026-09-27', '{}')")
  local dt=$(( $(date +%s) - t0 ))
  wait "$pid"
  local a; a=$(grep -v '^$' /tmp/wr_conc_a.out | head -1)
  echo "$nome: A=$a B=$b (B esperou ${dt}s)"
  [ "$a" = executar ] || { echo "FALHA: A devia executar"; exit 1; }
  [ "$b" = ocupada ] || { echo "FALHA: B devia receber ocupada"; exit 1; }
  [ "$dt" -ge 1 ] || { echo "FALHA: B não bloqueou no lock de A"; exit 1; }
}

# Variante 1: linha já existe (aberta e liberada antes).
psql_ -c "select public.liberar_execucao('backfill', '$ORG', (select lease from public.abrir_execucao('backfill', '$ORG', '2026-09-27', '{}')), null)" > /dev/null
variante "linha existente"

# Variante 2: linha inexistente nas duas sessões.
psql_ -c "delete from public.worker_rodadas where org_id = '$ORG'"
variante "linha inexistente"
echo "worker_rodadas_concorrencia: OK"
