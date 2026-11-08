#!/usr/bin/env bash
# ADR-0200 (Task 6, achado 2): corridas reais (duas sessões) de `kit_politica_operador` sobre SKU SEM linha de
# política. A sessão A executa e SEGURA a transação 3 s; a B começa 1 s depois, tem de ESPERAR e decidir sobre o
# que A commitou. Mesmo arranjo de kit_variacao_rpc_concorrencia.sh. Portão da Task 17 (Step 4b): NÃO executado
# nesta task.
#
# Uso: bash supabase/tests/kit_politica_operador_concorrencia.sh [container]
# Postgres LOCAL, nunca remoto. Exige as migrations kit_variacao_* e kit_politica_operador aplicadas no banco local.
set -euo pipefail
C="${1:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
ORG=97200000-0000-0000-0000-0000000000c1
OUT_A=$(mktemp)
psql_() { docker exec -i -e PGPASSWORD=postgres "$C" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
falha() { echo "FALHA: $*"; exit 1; }
limpar() {
  psql_ -c "delete from public.kit_ativacoes where org_id = '$ORG';
            delete from public.sku_politica_kit where org_id = '$ORG';
            delete from public.organizations where id = '$ORG';" > /dev/null
  rm -f "$OUT_A"
}
pol() { psql_ -c "select versao || '/' || bloqueio_operador from public.sku_politica_kit where org_id = '$ORG' and codigo = '$1'"; }

corrida() {
  local nome=$1
  psql_ -c "begin; $2; select pg_sleep(3); commit;" > "$OUT_A" 2>&1 &
  local pid=$!
  sleep 1
  local t0; t0=$(date +%s)
  set +e; B_OUT=$(psql_ -v VERBOSITY=verbose -c "$3" 2>&1); set -e
  DT=$(( $(date +%s) - t0 ))
  wait "$pid" || { cat "$OUT_A"; falha "$nome: sessão A falhou"; }
  A_OUT=$(grep -v '^$' "$OUT_A" | head -1)
  echo "$nome: A=$A_OUT | B=$B_OUT | B esperou ${DT}s"
  [ "$DT" -ge 1 ] || falha "$nome: B não bloqueou no lock de A"
  if echo "$B_OUT" | grep -q '40P01'; then falha "$nome: deadlock"; fi
}

limpar
trap limpar EXIT
psql_ -c "insert into public.organizations (id, nome, slug, modulos_habilitados, is_test)
            values ('$ORG', 'Kit operador conc', 'kit-operador-conc', array['kit_variacao'], true);"

# 1. Pausa (A) × reativação que leu "sem linha = 0" (B): B espera a linha que A inseriu e vê versão 1.
corrida "1 pausa×reativar" \
  "select public.kit_politica_operador('$ORG', array['P1'], true)" \
  "select public.kit_politica_operador('$ORG', array['P1'], false, '{\"P1\": 0}'::jsonb)"
[ "$B_OUT" = '{"ok": false, "codigo": "P1"}' ] || falha "1: B devia recusar pela versão"
[ "$(pol P1)" = '1/true' ] || falha "1: a pausa do operador foi apagada ($(pol P1))"

# 2. Reativação (A, materializa versão 0 e trava) × pausa (B): B espera e bloqueia depois do commit de A.
corrida "2 reativar×pausa" \
  "select public.kit_politica_operador('$ORG', array['P2'], false, '{\"P2\": 0}'::jsonb)" \
  "select public.kit_politica_operador('$ORG', array['P2'], true)"
[ "$A_OUT" = '{"ok": true}' ] || falha "2: A devia reativar"
[ "$(pol P2)" = '1/true' ] || falha "2: a pausa de B devia prevalecer ($(pol P2))"

# 3. Duas pausas na mesma linha ausente: um só incremento.
corrida "3 pausa×pausa" \
  "select public.kit_politica_operador('$ORG', array['P3'], true)" \
  "select public.kit_politica_operador('$ORG', array['P3'], true)"
[ "$(pol P3)" = '1/true' ] || falha "3: incremento duplicado ($(pol P3))"

# 4. Fix round 2: duas execuções do mesmo dono de ativação. B espera o insert de A e é recusada (geração viva).
D=97200000-0000-0000-0000-0000000000d1
corrida "4 reivindicar×reivindicar" \
  "select public.kit_ativacao_reivindicar('$ORG', '$D', 'MLB1', array['MLB1'], array['P4'], gen_random_uuid(), 600)" \
  "select public.kit_ativacao_reivindicar('$ORG', '$D', 'MLB1', array['MLB1'], array['P4'], gen_random_uuid(), 600)"
[ "$A_OUT" = '{"ok": true, "anterior": false}' ] || falha "4: A devia reivindicar"
[ "$B_OUT" = '{"ok": false}' ] || falha "4: B devia ser recusada com a geração de A viva"

echo "kit_politica_operador_concorrencia: OK"
