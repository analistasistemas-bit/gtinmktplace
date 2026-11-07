#!/usr/bin/env bash
# ADR-0197: corridas reais (duas sessões) das RPCs de transferência. Em cada variante a sessão A executa e
# SEGURA a transação 3 s; a B começa 1 s depois, tem de ESPERAR o lock de A e decidir sobre o que A commitou.
# Cada variante tem fixture própria (códigos 097NN...). Mesmo arranjo de reajuste_preco_concorrencia.sh.
#
# Uso: bash supabase/tests/kit_variacao_rpc_concorrencia.sh [container]
# Postgres LOCAL, nunca remoto: duas sessões só se enxergam com fixture commitada, e isso em produção
# deixaria dado. Exige as migrations kit_variacao_schema e kit_variacao_rpc aplicadas no banco local.
set -euo pipefail
C="${1:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
ORG=97100000-0000-0000-0000-0000000000c1
USR=97100000-0000-0000-0000-0000000000c2
OUT_A=$(mktemp)
psql_() { docker exec -i -e PGPASSWORD=postgres "$C" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
u() { printf '97100000-0000-0000-00%s-%012d' "$1" "$2"; }
falha() { echo "FALHA: $*"; exit 1; }
# Composição é imutável por trigger e o ledger tem FK: a limpeza desliga os dois, só nesta sessão.
limpar() {
  psql_ -c "set session_replication_role = replica;
            delete from public.estoque_movimentos where org_id = '$ORG';
            delete from public.kit_exclusoes where org_id = '$ORG';
            delete from public.kit_transferencias where org_id = '$ORG';
            delete from public.kit_variacao_componentes where org_id = '$ORG';
            delete from public.kit_variacao_skus where org_id = '$ORG';
            delete from public.kits_variacao where org_id = '$ORG';
            delete from public.variacoes where org_id = '$ORG';
            delete from public.familias where org_id = '$ORG';
            delete from public.lotes where org_id = '$ORG';
            delete from auth.users where id = '$USR';
            delete from public.organizations where id = '$ORG';" > /dev/null
  rm -f "$OUT_A"
}
confere() { [ "$(psql_ -c "select ($1)")" = t ] || falha "$2"; }

# fixture NN SALDO QTD: peças P e B com SALDO, kit K = P + B, transferências TA e TB de QTD kits.
fixture() {
  local n=$1 saldo=$2 qtd=$3
  local lote fb fk kit sku itens
  lote=$(u "$n" 201); fb=$(u "$n" 301); fk=$(u "$n" 302); kit=$(u "$n" 401); sku=$(u "$n" 402)
  P="097${n}001"; B="097${n}002"; K="097${n}101"; TA=$(u "$n" 501); TB=$(u "$n" 502)
  itens="[{\"codigo\":\"$K\",\"quantidade\":$qtd}]"
  psql_ <<SQL
insert into public.lotes (id, user_id, org_id, status, origem) values ('$lote', '$USR', '$ORG', 'processando', 'planilha');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro) values
  ('$fb', '$lote', '$USR', '$ORG', '097${n}000', 'Base', 'CREATE', 'nacional', gen_random_uuid()),
  ('$fk', '$lote', '$USR', '$ORG', '097${n}100', 'Kit', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, preco, estoque) values
  ('$fb', '$USR', '$ORG', '$P', 'P', 10, $saldo), ('$fb', '$USR', '$ORG', '$B', 'B', 10, $saldo),
  ('$fk', '$USR', '$ORG', '$K', 'K', 20, 0);
insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco)
  values ('$kit', '$ORG', '097${n}000', '097${n}100', 2, 20);
insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
  values ('$sku', '$ORG', '$kit', '$K', 'M', array['P','B'], 'P + B');
insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade)
  values ('$sku', '$ORG', '$P', 1), ('$sku', '$ORG', '$B', 1);
insert into public.kit_transferencias (id, org_id, kit_id, tipo, versao_politica, itens) values
  ('$TA', '$ORG', '$kit', 'montar', 1, '$itens'), ('$TB', '$ORG', '$kit', 'montar', 1, '$itens');
SQL
}
movs() { echo "(select count(*) from public.estoque_movimentos where transferencia_id = '$1')"; }
saldo() { echo "(select estoque from public.variacoes where org_id = '$ORG' and codigo = '$1')"; }
# Invariante 2 com kit zerado: individual + o que saiu e não chegou.
total() {
  echo "($(saldo "$1") - coalesce((select sum(m.quantidade) from public.estoque_movimentos m
    where m.org_id = '$ORG' and m.codigo = '$1' and m.motivo = 'kit_saida'), 0))"
}

# corrida NOME SQL_A SQL_B: A segura 3 s; B começa 1 s depois. Deixa A/B/DT para as asserções.
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
            values ('$ORG', 'Kit conc', 'kit-conc', array['kit_variacao'], true);
          insert into auth.users (id, email, raw_user_meta_data) values
            ('$USR', 'kit-conc@test.local', '{\"org_id\":\"$ORG\"}'::jsonb);"

OK='{"ok": true, "aplicado": true}'

# 1. Saldo de 3 para duas reservas de 2: uma reserva, outra insuficiente, nada parcial, peça conservada.
fixture 01 3 2
corrida "1 saldo insuficiente para ambas" \
  "select public.kit_reservar_transferencia('$ORG', '$TA')" \
  "select public.kit_reservar_transferencia('$ORG', '$TB')"
[ "$A_OUT" = "$OK" ] || falha "1: A devia reservar"
[ "$B_OUT" = "{\"ok\": false, \"codigo\": \"$P\", \"motivo\": \"peca_insuficiente\"}" ] || falha "1: B devia receber peca_insuficiente"
confere "$(movs "$TA") = 2" "1: A devia mover as 2 cores"
confere "$(movs "$TB") = 0" "1: B deixou movimento parcial"
confere "$(saldo "$P") = 1 and $(saldo "$B") = 1" "1: saldo das peças"
confere "$(saldo "$K") = 0" "1: reserva creditou o kit"
confere "$(total "$P") = 3 and $(total "$B") = 3" "1: conservação por componente"

# 2. Mesma transferência nas duas sessões: B espera a linha da transferência e aplica zero.
fixture 02 3 2
corrida "2 mesma transferência" \
  "select public.kit_reservar_transferencia('$ORG', '$TA')" \
  "select public.kit_reservar_transferencia('$ORG', '$TA')"
[ "$A_OUT" = "$OK" ] || falha "2: A devia reservar"
[ "$B_OUT" = '{"ok": true, "aplicado": false}' ] || falha "2: B devia cair na idempotência"
confere "$(movs "$TA") = 2" "2: movimento duplicado"
confere "$(saldo "$P") = 1 and $(saldo "$B") = 1" "2: baixou duas vezes"

# 3. Desligar × reservar: B espera o for update de A no for share e revalida o módulo depois do commit.
# A transferência só abre no commit de A; antes, o desligamento recusaria.
fixture 03 3 2
psql_ -c "update public.kit_transferencias set estado = 'concluida' where org_id = '$ORG'"
corrida "3 desligar×reservar" \
  "select public.set_modulos_org_seguro('$ORG', '{}'::text[]);
   update public.kit_transferencias set estado = 'ativa' where id = '$TA'" \
  "select public.kit_reservar_transferencia('$ORG', '$TA')"
[ "$A_OUT" = '{"ok": true}' ] || falha "3: A devia desligar"
[ "$B_OUT" = '{"ok": false, "motivo": "modulo_desligado"}' ] || falha "3: B devia ver o módulo desligado"
confere "$(movs "$TA") = 0" "3: reservou com módulo desligado"

# 4. Desligar × adquirir exclusão: mesmo lock na outra escritora.
psql_ -c "update public.organizations set modulos_habilitados = array['kit_variacao'] where id = '$ORG';
          update public.kit_transferencias set estado = 'concluida' where org_id = '$ORG'"
corrida "4 desligar×exclusão" \
  "select public.set_modulos_org_seguro('$ORG', '{}'::text[])" \
  "select public.kit_adquirir_exclusao('$ORG', array['$P'], 'transferencia', '$TB')"
[ "$A_OUT" = '{"ok": true}' ] || falha "4: A devia desligar"
[ "$B_OUT" = '{"ok": false, "motivo": "modulo_desligado"}' ] || falha "4: B devia ver o módulo desligado"
confere "not exists (select 1 from public.kit_exclusoes where org_id = '$ORG')" "4: exclusão gravada com módulo desligado"

echo "kit_variacao_rpc_concorrencia: OK"
