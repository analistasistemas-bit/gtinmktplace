#!/usr/bin/env bash
# Emenda 2026-11-08 ao ADR-0155: troca de preço por unidade × entregas (Sonar e Imagem IA) × fechamento, com
# duas sessões reais. Todos tomam o MESMO lock da org. A sessão A segura a transação 3 s; a B começa 1 s depois,
# tem de ESPERAR e decidir sobre o que A commitou. Mesmo arranjo de platform_imagem_ia_concorrencia.sh.
#
# Uso: bash supabase/tests/platform_precos_unidade_concorrencia.sh [container]
# Postgres LOCAL, nunca remoto, carregado com o schema de produção (supabase db dump --role-only + supabase db dump;
# drop schema public cascade; carregar os dois; recriar on_auth_user_created) + a migration 20261108141425.
set -euo pipefail
C="${1:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
ORG=97700000-0000-0000-0000-0000000000c1
ADM=97700000-0000-0000-0000-0000000000c2
CLI=97700000-0000-0000-0000-0000000000c3
OUT_A=$(mktemp)
psql_() { docker exec -i -e PGPASSWORD=postgres "$C" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
falha() { echo "FALHA: $*"; exit 1; }
limpar() {
  # Entregas, termos, auditoria e demonstrativos são append-only/imutáveis: replica desliga os gatilhos só aqui.
  psql_ -c "set session_replication_role = replica;
            delete from public.platform_image_deliveries where org_id = '$ORG';
            delete from public.kit_variacao_imagens where org_id = '$ORG';
            delete from public.platform_sonar_deliveries where org_id = '$ORG';
            delete from public.platform_sonar_events where org_id = '$ORG';
            delete from public.platform_sonar_searches where org_id = '$ORG';
            delete from public.platform_sonar_results where normalized_query like 'conc-preco-unidade-%';
            delete from public.platform_audit_events where org_id = '$ORG';
            delete from public.platform_billing_statements where org_id = '$ORG';
            delete from public.platform_commercial_terms where org_id = '$ORG';
            delete from public.profiles where id in ('$ADM', '$CLI');
            delete from auth.users where id in ('$ADM', '$CLI');
            delete from public.organizations where id = '$ORG';" > /dev/null
  rm -f "$OUT_A"
}
MES="date_trunc('month', clock_timestamp() at time zone 'America/Fortaleza')::date"
uuid() { psql_ -c "select gen_random_uuid()"; }
troca() {  # $1 = sonar, $2 = imagem
  echo "select public.platform_save_unit_prices('$ADM', jsonb_build_object('org_id', '$ORG', 'sonar_unit_cents', $1, 'image_unit_cents', $2,
          'expected_terms_id', (public.platform_resolve_terms('$ORG', $MES)).id))"
}
busca() {  # $1 = id do resultado. Resultado pronto + busca concluída ANTES da corrida, como no fluxo real
  # (platform_sonar_begin roda em outra transação): a corrida mede só a entrega, sem o lock de FK da busca.
  psql_ -c "insert into public.platform_sonar_results (id, normalized_query, query_type, schema_version, generation, payload, state, valid_until)
              values ('$1', 'conc-preco-unidade-$1', 'termo', 1, 1, '{\"itens\":[1]}'::jsonb, 'ready', now() + interval '7 days');
            insert into public.platform_sonar_searches (org_id, actor_id, request_id, intent_key, normalized_query, query_type, result_id, state, origin)
              values ('$ORG', '$CLI', gen_random_uuid(), 'query:termo:1:conc-preco-unidade-$1', 'conc-preco-unidade-$1', 'termo', '$1', 'completed', 'cliente');" > /dev/null
}
sonar() {  # $1 = id do resultado já preparado por busca()
  echo "select public.platform_sonar_delivery_json(s) from public.platform_sonar_searches s where s.result_id = '$1'"
}
imagem() {  # $1 = request_id
  echo "insert into public.kit_variacao_imagens (org_id, request_id, status, familia_base_id, cores, rotulo, modelo, storage_path, custo_usd)
        values ('$ORG', '$1', 'gerada', gen_random_uuid(), array['Preto','Branco'], 'Preto e Branco',
                'google/gemini-nano-banana-2.1', '$ORG/kit-variacao-ia/$1.png', 0.041)"
}
preco_sonar() { psql_ -c "select unit_cents || '/' || month::text || '/' || units from public.platform_sonar_deliveries where org_id = '$ORG' and result_id = '$1'"; }
preco_imagem() { psql_ -c "select unit_cents from public.platform_image_deliveries where org_id = '$ORG' and request_id = '$1'"; }

corrida() {
  local nome=$1
  psql_ -c "begin; $2; select pg_sleep(3); commit;" > "$OUT_A" 2>&1 &
  local pid=$!
  sleep 1
  local t0; t0=$(date +%s)
  set +e; B_OUT=$(psql_ -v VERBOSITY=verbose -c "$3" 2>&1); local rc=$?; set -e
  DT=$(( $(date +%s) - t0 ))
  wait "$pid" || { cat "$OUT_A"; falha "$nome: sessão A falhou"; }
  echo "$nome: B esperou ${DT}s"
  [ "$rc" -eq 0 ] || falha "$nome: sessão B falhou: $B_OUT"
  [ "$DT" -ge 1 ] || falha "$nome: B não bloqueou no lock de A"
  if echo "$B_OUT" | grep -q '40P01'; then falha "$nome: deadlock"; fi
}

limpar
trap limpar EXIT
psql_ -c "insert into public.organizations (id, nome, slug, modulos_habilitados, is_test)
            values ('$ORG', 'Preço unidade conc', 'preco-unidade-conc', array['pulse','kit_variacao','imagem_ia'], true);
          insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
            ('$ADM', 'preco-unidade-conc-adm@teste.local', '{}'::jsonb, '{\"org_id\":\"$ORG\"}'::jsonb),
            ('$CLI', 'preco-unidade-conc-cli@teste.local', '{}'::jsonb, '{\"org_id\":\"$ORG\"}'::jsonb);
          update public.profiles set is_super_admin = true, org_id = null, is_active = true where id = '$ADM';
          update public.profiles set is_super_admin = false, org_id = '$ORG', is_active = true where id = '$CLI';
          insert into public.platform_commercial_terms (org_id, starts_on, modality, monthly_fee_cents,
            revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4, sonar_unit_cents, image_unit_cents,
            setup_fee_cents, setup_due_month, reason, created_by, version)
          values ('$ORG', ($MES - interval '1 month')::date, 2, 0, 700, 600, 550, 500, 100, 50, 0, null, 'conc', '$ADM', 1);" > /dev/null

# 1. Troca (A) × consulta Sonar (B): B espera o commit de A e cobra o preço NOVO.
R=$(uuid); busca "$R"
corrida "1 troca×Sonar" "$(troca 150 80)" "$(sonar "$R")"
[ "$(preco_sonar "$R")" = "150/$(psql_ -c "select $MES")/1" ] || falha "1: Sonar não pegou o preço novo ($(preco_sonar "$R"))"

# 2. Consulta Sonar (A) × troca (B): A cobra o preço VIGENTE quando consultou; B espera e grava depois.
R=$(uuid); busca "$R"
corrida "2 Sonar×troca" "$(sonar "$R")" "$(troca 200 90)"
[ "$(preco_sonar "$R" | cut -d/ -f1)" = 150 ] || falha "2: Sonar anterior não ficou com o preço antigo ($(preco_sonar "$R"))"

# 3. Troca (A) × imagem (B): B espera e cobra o preço NOVO.
R=$(uuid); busca "$R"
corrida "3 troca×imagem" "$(troca 200 100)" "$(imagem "$R")"
[ "$(preco_imagem "$R")" = 100 ] || falha "3: imagem não pegou o preço novo ($(preco_imagem "$R"))"

# 4. Imagem (A) × troca (B): A cobra o preço antigo.
R=$(uuid); busca "$R"
corrida "4 imagem×troca" "$(imagem "$R")" "$(troca 200 110)"
[ "$(preco_imagem "$R")" = 100 ] || falha "4: imagem anterior não ficou com o preço antigo ($(preco_imagem "$R"))"

# 5. Fechamento da competência corrente (A, como o close na virada) × consulta Sonar (B): B espera e grava na
#    competência aberta seguinte, nunca na fechada.
R=$(uuid); busca "$R"
corrida "5 fechamento×Sonar" \
  "select 1 from public.organizations where id = '$ORG' for update;
   insert into public.platform_billing_statements (org_id, month, terms_id, revenue_bps, gross_cents, refund_cents,
     base_cents, fee_cents, sonar_cents, credit_cents, total_cents, revision, snapshot, closed_by)
   select '$ORG', $MES, id, 700, 0, 0, 0, 0, 0, 0, 0, 'conc', '{}'::jsonb, '$ADM'
     from public.platform_commercial_terms where org_id = '$ORG' order by starts_on desc, version desc limit 1" \
  "$(sonar "$R")"
[ "$(preco_sonar "$R" | cut -d/ -f2)" = "$(psql_ -c "select ($MES + interval '1 month')::date")" ] \
  || falha "5: Sonar caiu em competência fechada ($(preco_sonar "$R"))"

# 6. Fechamento (A) × troca (B): B espera e recusa (competência já fechada).
set +e
psql_ -c "begin; select 1 from public.organizations where id = '$ORG' for update; select pg_sleep(2); commit;" > /dev/null 2>&1 &
sleep 1
B_OUT=$(psql_ -c "$(troca 300 120)" 2>&1); RC=$?
set -e
wait
[ "$RC" -ne 0 ] && echo "$B_OUT" | grep -q 'demonstrativo fechado' || falha "6: troca aceita em competência fechada ($B_OUT)"
echo "6 fechamento×troca: recusou"

# 7. Resultado travado como platform_sonar_complete trava (A: for no key update) × entrega sobre o mesmo
#    resultado (B, outra busca): o FK result_id pede key share, que é compatível — B não espera. Com `for update`
#    B esperaria, e somado ao fechamento (lock da org + share em platform_sonar_deliveries) fechava ciclo.
R=$(uuid); busca "$R"
psql_ -c "insert into public.platform_sonar_searches (org_id, actor_id, request_id, intent_key, normalized_query, query_type, result_id, state, origin)
            select org_id, actor_id, gen_random_uuid(), intent_key || ':2', normalized_query, query_type, result_id, state, origin
              from public.platform_sonar_searches where result_id = '$R'" > /dev/null
LOCK_MODE=$(psql_ -c "select case when position('for no key update' in prosrc) > 0 then 'no key update' else 'update' end
                      from pg_proc where proname = 'platform_sonar_complete'")
psql_ -c "begin; select 1 from public.platform_sonar_results where id = '$R' for $LOCK_MODE; select pg_sleep(3); commit;" > /dev/null 2>&1 &
sleep 1
t0=$(date +%s)
psql_ -c "select public.platform_sonar_delivery_json(s) from public.platform_sonar_searches s where s.result_id = '$R' and s.intent_key like '%:2'" > /dev/null
DT=$(( $(date +%s) - t0 ))
wait
echo "7 resultado travado×entrega ($LOCK_MODE): B esperou ${DT}s"
[ "$DT" -lt 1 ] || falha "7: entrega esperou o lock do resultado (complete usa for $LOCK_MODE)"

echo "platform_precos_unidade_concorrencia: OK"
