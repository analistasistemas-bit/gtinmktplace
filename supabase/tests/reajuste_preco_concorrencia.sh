#!/usr/bin/env bash
# ADR-0178 C2 — corridas reais (duas sessões) entre os escritores de preço. Em cada variante a sessão A
# executa e SEGURA a transação 3 s; a B começa 1 s depois, tem de ESPERAR o lock de A e, após o commit,
# receber a recusa/ocupado. Cada variante tem fixture própria (codigo_pai 094NN000, MLB MLBCNN).
# Uso: bash supabase/tests/reajuste_preco_concorrencia.sh [container]  (Postgres LOCAL, nunca remoto;
# exige as migrations do reajuste aplicadas no banco local)
set -euo pipefail
C="${1:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
ORG=94000000-0000-0000-0000-0000000000c1
USR=94000000-0000-0000-0000-0000000000c2
OUT_A=$(mktemp)
psql_() { docker exec -i -e PGPASSWORD=postgres "$C" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
u() { printf '94000000-0000-0000-00%s-%012d' "$1" "$2"; }
falha() { echo "FALHA: $*"; exit 1; }
limpar() {
  psql_ -c "delete from public.operacoes_massa where org_id = '$ORG';
            delete from public.anuncios_externos where org_id = '$ORG';
            delete from public.variacoes where org_id = '$ORG';
            delete from public.familias where org_id = '$ORG';
            delete from public.lotes where org_id = '$ORG';
            delete from auth.users where id = '$USR';
            delete from public.organizations where id = '$ORG';" > /dev/null
  rm -f "$OUT_A"
}
confere() { [ "$(psql_ -c "select ($1)")" = t ] || falha "$2"; }

limpar
trap limpar EXIT
psql_ -c "insert into public.organizations (id, nome, slug) values ('$ORG', 'Reajuste conc', 'reajuste-conc');
          insert into auth.users (id, email, raw_user_meta_data) values
            ('$USR', 'reajuste-conc@test.local', '{\"org_id\":\"$ORG\"}'::jsonb);"

MOT_PUB='Família em publicação/atualização — tente depois'

# fixture NN STATUS_ITEM: lotes L1/L2, F1 (UPDATE pronto, publicada no MLB), 1 cor, raiz ML partição 0,
# operação reajustar executando (OP) e, se STATUS_ITEM <> none, o item do MLB.
fixture() {
  local n=$1 st=$2
  PAI="094${n}000"; MLB="MLBC$n"
  L1=$(u "$n" 201); L2=$(u "$n" 202); F1=$(u "$n" 301); F2=$(u "$n" 302); OP=$(u "$n" 501); AD=$(u "$n" 502)
  psql_ -c "insert into public.lotes (id, user_id, org_id, status, origem) values
              ('$L1', '$USR', '$ORG', 'processando', 'manual'), ('$L2', '$USR', '$ORG', 'processando', 'manual');
            insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id, publicado_em)
              values ('$F1', '$L1', '$USR', '$ORG', '$PAI', 'Conc', 'UPDATE', 'pronto', 'nacional', gen_random_uuid(), '$MLB', now() - interval '1 day');
            insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, preco, preco_publicacao)
              values ('$F1', '$USR', '$ORG', '094${n}001', 'A', 10, 100);
            insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, particao, item_externo_id)
              values ('$USR', '$ORG', 'mercado_livre', '$PAI', 0, '$MLB');
            insert into public.operacoes_massa (id, org_id, acao, status) values ('$OP', '$ORG', 'reajustar', 'executando');"
  case "$st" in
    none) ;;
    pendente) psql_ -c "insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, codigo_pai)
                        values ('$OP', '$ORG', '$MLB', 'pendente', '$PAI')" ;;
    conferindo_vencido) psql_ -c "insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, codigo_pai, etapa, proxima_conferencia)
                        values ('$OP', '$ORG', '$MLB', 'conferindo', '$PAI', 'escrita_pedida', now() - interval '1 minute')" ;;
    enviando_parado) psql_ -c "insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, codigo_pai, atualizado_em)
                        values ('$OP', '$ORG', '$MLB', 'enviando', '$PAI', now() - interval '5 minutes')" ;;
  esac
}
aderir_pendente() {
  psql_ -c "insert into public.operacoes_massa (id, org_id, acao, promocao_id, promocao_tipo, status) values ('$AD', '$ORG', 'aderir', 'P-$1', 'DEAL', 'executando');
            insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status) values ('$AD', '$ORG', 'P-$1', '$MLB', 'pendente');"
}
item() { echo "(select $1 from public.operacoes_massa_itens where operacao_id = '$OP' and ml_item_id = '$MLB')"; }

# corrida NOME SQL_A SQL_B: A segura 3 s; B começa 1 s depois. Deixa A/B/DT para as asserções.
corrida() {
  local nome=$1
  psql_ -c "begin; $2; select pg_sleep(3); commit;" > "$OUT_A" 2>&1 &
  local pid=$!
  sleep 1
  local t0; t0=$(date +%s)
  set +e; B=$(psql_ -v VERBOSITY=verbose -c "$3" 2>&1); set -e
  DT=$(( $(date +%s) - t0 ))
  wait "$pid" || { cat "$OUT_A"; falha "$nome: sessão A falhou"; }
  A=$(grep -v '^$' "$OUT_A" | head -1)
  echo "$nome: A=$A | B=$B | B esperou ${DT}s"
  [ "$DT" -ge 1 ] || falha "$nome: B não bloqueou no lock de A"
  if echo "$B" | grep -q '40P01'; then falha "$nome: deadlock"; fi
}

# 1. reajuste × publicação (F1).
fixture 01 pendente
corrida "1 reajuste×publicação" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')" \
  "select motivo from public.familia_reservar_publicacao('$ORG', array['$F1']::uuid[], 'UPDATE')"
[ "$A" = ok ] || falha "1: A"
[ "$B" = "Há reajuste de preço em massa em andamento no anúncio $MLB" ] || falha "1: B"
confere "(select status = 'pronto' from public.familias where id = '$F1')" "1: F1 devia continuar pronto"
confere "$(item "status = 'enviando'")" "1: item enviando"

# 2. publicação × reajuste: A reserva F1 sem reajuste ativo; o item pendente só passa a existir no commit de A.
fixture 02 none
corrida "2 publicação×reajuste" \
  "select count(*) from public.familia_reservar_publicacao('$ORG', array['$F1']::uuid[], 'UPDATE') where motivo is null;
   insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, codigo_pai) values ('$OP', '$ORG', '$MLB', 'pendente', '$PAI')" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')"
[ "$A" = 1 ] || falha "2: A"
[ "$B" = "$MOT_PUB" ] || falha "2: B"
confere "$(item "status = 'bloqueado' and mensagem = '$MOT_PUB'")" "2: item bloqueado pela RPC de B"
confere "(select status = 'publicando' from public.familias where id = '$F1')" "2: F1 publicando"

# 3. reajuste × publicação de F2 recém-criada do mesmo produto.
fixture 03 pendente
psql_ -c "insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id)
          values ('$F2', '$L2', '$USR', '$ORG', '$PAI', 'Conc', 'UPDATE', 'pronto', 'nacional', gen_random_uuid(), '$MLB')"
corrida "3 reajuste×publicação F2" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')" \
  "select motivo from public.familia_reservar_publicacao('$ORG', array['$F2']::uuid[], 'UPDATE')"
[ "$A" = ok ] || falha "3: A"
[ "$B" = "Há reajuste de preço em massa em andamento no anúncio $MLB" ] || falha "3: B"
confere "(select status = 'pronto' from public.familias where id = '$F2')" "3: F2 devia continuar pronto"

# 4. reajuste × aderir.
# O item aderir pendente só passa a existir no commit de A (antes, o reajuste recusaria pela promoção).
fixture 04 pendente
aderir_pendente 04
psql_ -c "update public.operacoes_massa_itens set status = 'bloqueado' where operacao_id = '$AD'"
corrida "4 reajuste×aderir" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB');
   update public.operacoes_massa_itens set status = 'pendente' where operacao_id = '$AD'" \
  "select public.operacoes_massa_reivindicar('$ORG', '$AD', '$MLB')"
[ "$A" = ok ] || falha "4: A"
[ "$B" = f ] || falha "4: B"
confere "(select status = 'mudou' and mensagem = 'Reajuste de preço em andamento neste anúncio' from public.operacoes_massa_itens where operacao_id = '$AD')" "4: aderir mudou"

# 5. aderir × reajuste.
# O item de reajuste pendente só passa a existir no commit de A (antes, o aderir viraria mudou).
fixture 05 none
aderir_pendente 05
corrida "5 aderir×reajuste" \
  "select public.operacoes_massa_reivindicar('$ORG', '$AD', '$MLB');
   insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, codigo_pai) values ('$OP', '$ORG', '$MLB', 'pendente', '$PAI')" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')"
[ "$A" = t ] || falha "5: A"
[ "$B" = 'Anúncio em operação de promoção em andamento' ] || falha "5: B"
confere "(select status = 'enviando' from public.operacoes_massa_itens where operacao_id = '$AD')" "5: aderir enviando"
confere "$(item "status = 'bloqueado'")" "5: reajuste bloqueado"

# 6a. reajuste × PxV.
CAMPOS='{"migracao_pxv_status":"solicitada","migracao_pxv_solicitada_em":"2026-10-04T12:00:00Z","migracao_pxv_snapshot":[],"migracao_pxv_erro":null,"migracao_pxv_tentativa":0,"ml_item_id_anterior":"X"}'
fixture 06 pendente
corrida "6a reajuste×PxV" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')" \
  "select public.familia_reservar_migracao_pxv('$ORG', '$PAI', '$CAMPOS')"
[ "$A" = ok ] || falha "6a: A"
[ "$B" = "Há reajuste de preço em massa em andamento no anúncio $MLB" ] || falha "6a: B"
confere "(select migracao_pxv_status is null from public.anuncios_externos where org_id = '$ORG' and codigo_pai = '$PAI')" "6a: raiz intocada"

# 6b. PxV × reajuste.
fixture 07 pendente
psql_ -c "update public.operacoes_massa_itens set status = 'aplicado' where operacao_id = '$OP'"
corrida "6b PxV×reajuste" \
  "select public.familia_reservar_migracao_pxv('$ORG', '$PAI', '$CAMPOS');
   update public.operacoes_massa_itens set status = 'pendente' where operacao_id = '$OP'" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')"
[ "$A" = ok ] || falha "6b: A"
[ "$B" = 'Migração para preço por variação em curso' ] || falha "6b: B"
confere "(select migracao_pxv_status = 'solicitada' from public.anuncios_externos where org_id = '$ORG' and codigo_pai = '$PAI')" "6b: raiz solicitada"
confere "$(item "status = 'bloqueado'")" "6b: item bloqueado"

# 7a/7b. reajuste × reajuste na retomada (conferindo vencido / enviando parado).
fixture 08 conferindo_vencido
corrida "7a retomada conferindo" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')"
[ "$A" = ok ] || falha "7a: A"; [ "$B" = ocupado ] || falha "7a: B"
confere "$(item "status = 'enviando' and etapa = 'escrita_pedida'")" "7a: enviando com etapa"
fixture 09 enviando_parado
corrida "7b retomada enviando parado" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')"
[ "$A" = ok ] || falha "7b: A"; [ "$B" = ocupado ] || falha "7b: B"
confere "$(item "status = 'enviando' and atualizado_em > now() - interval '1 minute'")" "7b: enviando renovado"

# 8. confirmar × confirmar da mesma operação.
fixture 10 none
psql_ -c "update public.operacoes_massa set status = 'rascunho', expira_em = now() + interval '30 minutes' where id = '$OP';
          insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, codigo_pai, avaliacao)
          values ('$OP', '$ORG', '$MLB', 'rascunho', '$PAI', '{}')"
corrida "8 confirmar×confirmar" \
  "select public.reajuste_confirmar('$ORG', '$OP', '[]')" \
  "select public.reajuste_confirmar('$ORG', '$OP', '[]')"
[ "$A" = ok ] || falha "8: A"; [ "$B" = ja_confirmada ] || falha "8: B"
confere "(select status = 'executando' from public.operacoes_massa where id = '$OP')" "8: executando"
confere "$(item "status = 'pendente'")" "8: item pendente"

# 9. dois rascunhos DIFERENTES com os mesmos MLBs X/Y confirmados juntos → sem deadlock.
fixture 11 none
R2=$(u 11 504)
psql_ -c "update public.operacoes_massa set status = 'rascunho', expira_em = now() + interval '30 minutes' where id = '$OP';
          insert into public.operacoes_massa (id, org_id, acao, status, expira_em) values ('$R2', '$ORG', 'reajustar', 'rascunho', now() + interval '30 minutes');
          insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, avaliacao, codigo_pai) values
            ('$OP', '$ORG', 'MLBC11Y', 'rascunho', '{}', '$PAI'), ('$OP', '$ORG', 'MLBC11X', 'rascunho', '{}', '$PAI'),
            ('$R2', '$ORG', 'MLBC11X', 'rascunho', '{}', '$PAI'), ('$R2', '$ORG', 'MLBC11Y', 'rascunho', '{}', '$PAI')"
corrida "9 rascunhos sobrepostos" \
  "select public.reajuste_confirmar('$ORG', '$OP', '[]')" \
  "select public.reajuste_confirmar('$ORG', '$R2', '[]')"
[ "$A" = ok ] || falha "9: A"
echo "$B" | grep -q 'P0001: ocupado:MLBC11X' || falha "9: B devia receber P0001 ocupado:MLBC11X"
confere "(select status = 'executando' from public.operacoes_massa where id = '$OP')
         and (select count(*) = 2 from public.operacoes_massa_itens where operacao_id = '$OP' and status = 'pendente')" "9: R1 executando"
confere "(select status = 'rascunho' from public.operacoes_massa where id = '$R2')
         and (select count(*) = 2 from public.operacoes_massa_itens where operacao_id = '$R2' and status = 'rascunho')" "9: R2 intacto"

# 10. publicação (segura) × reajuste B (recusa, grava bloqueado) × depois C de outro worker → ocupado.
fixture 12 none
corrida "10 publicação×reajuste×C" \
  "select count(*) from public.familia_reservar_publicacao('$ORG', array['$F1']::uuid[], 'UPDATE') where motivo is null;
   insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, codigo_pai) values ('$OP', '$ORG', '$MLB', 'pendente', '$PAI')" \
  "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')"
[ "$A" = 1 ] || falha "10: A"; [ "$B" = "$MOT_PUB" ] || falha "10: B"
CR=$(psql_ -c "select public.reajuste_reivindicar('$ORG', '$OP', '$MLB')")
echo "10 C=$CR"
[ "$CR" = ocupado ] || falha "10: C devia receber ocupado"
confere "$(item "status = 'bloqueado' and mensagem = '$MOT_PUB'")" "10: C não sobrescreveu"

echo "reajuste_preco_concorrencia: OK"
