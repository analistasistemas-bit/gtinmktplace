#!/usr/bin/env bash
# ADR-0199 (Task 7, fix round 1): corridas reais (duas sessões) dos guards de saldo e composição. A sessão A
# executa e SEGURA a transação 3 s; a B começa 1 s depois, tem de ESPERAR e decidir sobre o que A commitou.
# Mesmo arranjo de kit_politica_operador_concorrencia.sh. Portão da Task 17 (Step 4b): NÃO executado nesta task.
# O mesmo cenário roda sequencial em kit_variacao_guards.sql (blocos 1b e 5b).
#
# Uso: bash supabase/tests/kit_variacao_guards_concorrencia.sh [container]
# Postgres LOCAL, nunca remoto. Exige as migrations kit_variacao_* aplicadas no banco local.
set -euo pipefail
C="${1:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
ORG=97300000-0000-0000-0000-0000000000c1
USR=97300000-0000-0000-0000-0000000000c2
KIT=97300000-0000-0000-0000-0000000000c3
KS=97300000-0000-0000-0000-0000000000c4
F1=97300000-0000-0000-0000-0000000000f1
F2=97300000-0000-0000-0000-0000000000f2
OUT_A=$(mktemp)
psql_() { docker exec -i -e PGPASSWORD=postgres "$C" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
falha() { echo "FALHA: $*"; exit 1; }
limpar() {
  psql_ -c "delete from public.kit_exclusoes where org_id = '$ORG';
            delete from public.kit_transferencia_alvos where org_id = '$ORG';
            delete from public.estoque_movimentos where org_id = '$ORG';
            delete from public.kit_transferencias where org_id = '$ORG';
            delete from public.sku_politica_kit where org_id = '$ORG';
            alter table public.kit_variacao_componentes disable trigger kit_variacao_componentes_imutavel;
            delete from public.kit_variacao_componentes where org_id = '$ORG';
            alter table public.kit_variacao_componentes enable trigger kit_variacao_componentes_imutavel;
            delete from public.kit_variacao_skus where org_id = '$ORG';
            delete from public.kits_variacao where org_id = '$ORG';
            delete from public.anuncios_externos where org_id = '$ORG';
            alter table public.variacoes disable trigger variacoes_kit_preservar_composicao;
            alter table public.familias disable trigger familias_kit_preservar_composicao;
            delete from public.familias where org_id = '$ORG';
            alter table public.variacoes enable trigger variacoes_kit_preservar_composicao;
            alter table public.familias enable trigger familias_kit_preservar_composicao;
            delete from public.lotes where org_id = '$ORG';
            delete from public.profiles where id = '$USR';
            delete from auth.users where id = '$USR';
            delete from public.organizations where id = '$ORG';" > /dev/null
  rm -f "$OUT_A"
}
saldo() { psql_ -c "select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
                    where v.org_id = '$ORG' and v.codigo = '$1' order by f.criado_em desc limit 1"; }

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
psql_ -c "
  insert into public.organizations (id, nome, slug, modulos_habilitados, is_test)
  values ('$ORG', 'Kit guards conc', 'kit-guards-conc', array['kit_variacao'], true);
  insert into auth.users (id, email, raw_user_meta_data) values ('$USR', 'kit-guards-conc@teste.local', '{\"org_id\":\"$ORG\"}');
  insert into public.profiles (id, org_id, is_active) values ('$USR', '$ORG', true)
  on conflict (id) do update set org_id = excluded.org_id, is_active = true;
  insert into public.lotes (id, user_id, org_id, status, origem) values
    ('$F1', '$USR', '$ORG', 'processando', 'planilha'), ('$F2', '$USR', '$ORG', 'processando', 'planilha');
  insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, criado_em, ml_item_id, status)
  values ('$F1', '$F1', '$USR', '$ORG', '09950000', 'Base conc', 'CREATE', 'nacional', gen_random_uuid(), now() - interval '2 days', 'MLB9950', 'publicado');
  insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, preco, estoque)
  values ('$F1', '$USR', '$ORG', '09950001', 'A', 'A', 50, 5), ('$F1', '$USR', '$ORG', '09950002', 'B', 'B', 50, 5),
         ('$F1', '$USR', '$ORG', '09950011', 'KIT', 'KIT', 90, 0);
  insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco)
  values ('$KIT', '$ORG', '09950000', '09960000', 2, 90);
  insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
  values ('$KS', '$ORG', '$KIT', '09950011', 'M', array['A', 'B'], 'A + B');
  insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade)
  values ('$KS', '$ORG', '09950001', 1), ('$KS', '$ORG', '09950002', 1);"

# 1. Nova cópia (A, trava a canônica antiga) × venda que resolveu a cópia antiga (B): B espera e é recusada com
#    canonica_trocou, sem movimento; a repetição baixa a cópia nova. Antes do fix, B baixava a cópia antiga e a
#    nova ficava com o saldo velho.
corrida "1 cópia×venda" \
  "insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, criado_em, ml_item_id, status)
     values ('$F2', '$F2', '$USR', '$ORG', '09950000', 'Base conc', 'UPDATE', 'nacional', gen_random_uuid(), now(), 'MLB9950', 'pronto');
   insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, preco, estoque)
     values ('$F2', '$USR', '$ORG', '09950001', 'A', 'A', 50, 999)" \
  "select public.baixar_estoque('$ORG', '09950001', 1, 'mercado_livre', 'conc-1')"
echo "$B_OUT" | grep -q 'canonica_trocou' || falha "1: B devia receber canonica_trocou"
[ "$(psql_ -c "select count(*) from public.estoque_movimentos where org_id = '$ORG' and referencia_externa = 'conc-1'")" = 0 ] \
  || falha "1: a recusa não pode deixar movimento"
psql_ -c "select public.baixar_estoque('$ORG', '09950001', 1, 'mercado_livre', 'conc-1')" > /dev/null
[ "$(saldo 09950001)" = 4 ] || falha "1: a repetição devia baixar a cópia nova ($(saldo 09950001))"

# 2. Transferência criada (A) × republicação (B): B espera a exclusão de A e recusa depois do commit.
ALVOS="[{\"codigo\": \"09950011\", \"up_id\": \"UP11\", \"item_ids\": [\"MLB11\"]},
        {\"codigo\": \"09950001\", \"up_id\": \"UP1\", \"item_ids\": [\"MLB1\"]},
        {\"codigo\": \"09950002\", \"up_id\": \"UP2\", \"item_ids\": [\"MLB2\"]}]"
corrida "2 transferência×republicar" \
  "select public.kit_criar_transferencia('$ORG', '$KIT', 'montar', '[{\"codigo\": \"09950011\", \"quantidade\": 1}]', '$ALVOS')" \
  "select * from public.preparar_republicacao('$ORG', 'mercado_livre', '09950000', '$F1')"
echo "$B_OUT" | grep -q 'republicar:kit_em_transferencia' || falha "2: B devia recusar pela transferência"
psql_ -c "update public.kit_transferencias set estado = 'abortada' where org_id = '$ORG';
          delete from public.kit_exclusoes where org_id = '$ORG';" > /dev/null

# 3. Republicação (A, segura a exclusão até o commit) × transferência (B): B espera; depois do commit cria com a
#    soma de versões lida ANTES (velha), e a saga recusa reativar (kit_saga_pode_reativar compara a soma).
corrida "3 republicar×transferência" \
  "select * from public.preparar_republicacao('$ORG', 'mercado_livre', '09950000', '$F1')" \
  "select public.kit_criar_transferencia('$ORG', '$KIT', 'montar', '[{\"codigo\": \"09950011\", \"quantidade\": 1}]', '$ALVOS')"
[ "$DT" -ge 2 ] || falha "3: B devia esperar a exclusão da republicação"
SOMA=$(psql_ -c "select coalesce(sum(versao), 0) from public.sku_politica_kit where org_id = '$ORG' and codigo in ('09950001', '09950002', '09950011')")
[ "$(psql_ -c "select versao_politica from public.kit_transferencias where org_id = '$ORG' and estado = 'ativa'")" != "$SOMA" ] \
  || falha "3: a transferência devia nascer com a versão anterior à republicação"

# 4. Fix rounds 2–3: duas cópias concorrentes + venda. A insere V1 e segura 3 s; B (t=1) insere V2 e espera a
#    canônica V0. A commita: B acorda com V0, que já não é a canônica, e recusa com canonica_trocou (40001) sem
#    pegar outro lock. A venda S (t=3.5) baixa V1. O chamador repete B (comRetryConcorrencia), que copia V1 já
#    baixada. Sem a recusa, B copiaria V0 e o saldo voltaria ao valor anterior à venda.
F3=97300000-0000-0000-0000-0000000000f3
F4=97300000-0000-0000-0000-0000000000f4
F5=97300000-0000-0000-0000-0000000000f5
OUT_B=$(mktemp)
psql_ -c "update public.kit_transferencias set estado = 'abortada' where org_id = '$ORG';
          delete from public.kit_exclusoes where org_id = '$ORG';
          insert into public.lotes (id, user_id, org_id, status, origem) values
            ('$F3', '$USR', '$ORG', 'processando', 'planilha'), ('$F4', '$USR', '$ORG', 'processando', 'planilha'),
            ('$F5', '$USR', '$ORG', 'processando', 'planilha');" > /dev/null
ANTES=$(saldo 09950002)
copia() {
  echo "begin;
    insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, criado_em, ml_item_id, status)
      values ('$1', '$1', '$USR', '$ORG', '09950000', 'Base conc', 'UPDATE', 'nacional', gen_random_uuid(), now() + interval '$2', 'MLB9950', 'pronto')
      on conflict (id) do nothing;
    insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, preco, estoque)
      values ('$1', '$USR', '$ORG', '09950002', 'B', 'B', 50, 999);
    select pg_sleep(${3:-0}); commit;"
}
psql_ -c "$(copia "$F3" '1 hour' 3)" > /dev/null 2>&1 &
PA=$!
sleep 1
set +e; psql_ -v VERBOSITY=verbose -c "$(copia "$F4" '2 hours')" > "$OUT_B" 2>&1; B_RC=$?; set -e
wait "$PA" || falha "4: cópia A falhou"
[ "$B_RC" -ne 0 ] && grep -q '40001' "$OUT_B" || falha "4: B devia recusar com 40001 ($(cat "$OUT_B"))"
grep -q '40P01' "$OUT_B" && falha "4: deadlock"
psql_ -c "select public.baixar_estoque('$ORG', '09950002', 1, 'mercado_livre', 'conc-4')" > /dev/null
psql_ -c "$(copia "$F4" '2 hours')" > /dev/null || falha "4: a repetição de B devia gravar"
[ "$(saldo 09950002)" = $((ANTES - 1)) ] || falha "4: saldo final $(saldo 09950002), esperado $((ANTES - 1))"

# 5. Fix round 3: cópia × exclusão. D apaga a canônica V2 (trava V2 e depois V1, para onde leva o saldo) e segura
#    3 s; E (t=1) insere V3 e espera V2. D commita: E acorda numa linha apagada, recusa com 40001 sem pegar outro
#    lock (nada de 40P01), e a repetição copia V1 com o saldo transportado.
ANTES=$(saldo 09950002)
psql_ -c "begin; delete from public.variacoes where familia_id = '$F4' and codigo = '09950002'; select pg_sleep(3); commit;" > "$OUT_A" 2>&1 &
PD=$!
sleep 1
set +e; psql_ -v VERBOSITY=verbose -c "$(copia "$F5" '3 hours')" > "$OUT_B" 2>&1; E_RC=$?; set -e
wait "$PD" || { cat "$OUT_A"; falha "5: exclusão D falhou"; }
grep -q '40P01' "$OUT_B" && falha "5: deadlock entre cópia e exclusão"
[ "$E_RC" -ne 0 ] && grep -q '40001' "$OUT_B" || falha "5: E devia recusar com 40001 ($(cat "$OUT_B"))"
psql_ -c "$(copia "$F5" '3 hours')" > /dev/null || falha "5: a repetição de E devia gravar"
[ "$(saldo 09950002)" = "$ANTES" ] || falha "5: saldo $(saldo 09950002), esperado $ANTES (transportado pela exclusão)"
rm -f "$OUT_B"

echo "kit_variacao_guards_concorrencia: OK"
