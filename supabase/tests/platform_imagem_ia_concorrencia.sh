#!/usr/bin/env bash
# Task 16 (fix round 1, P1): virada do mês com duas sessões reais. A entrega de imagem IA (gatilho em
# kit_variacao_imagens) toma o MESMO lock da org que platform_billing_close. A sessão A segura a transação
# 3 s; a B começa 1 s depois, tem de ESPERAR e decidir sobre o que A commitou. Mesmo arranjo de
# kit_politica_operador_concorrencia.sh. Portão da Task 17 (Step 4b): NÃO executado nesta task.
#
# Uso: bash supabase/tests/platform_imagem_ia_concorrencia.sh [container]
# Postgres LOCAL, nunca remoto. Exige as migrations kit_variacao_* e 20261108094500 aplicadas no banco local.
set -euo pipefail
C="${1:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
ORG=97600000-0000-0000-0000-0000000000c1
ADM=97600000-0000-0000-0000-0000000000c2
OUT_A=$(mktemp)
psql_() { docker exec -i -e PGPASSWORD=postgres "$C" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
falha() { echo "FALHA: $*"; exit 1; }
limpar() {
  # Entregas, termos e demonstrativos são append-only/imutáveis: replica desliga os gatilhos só nesta limpeza.
  psql_ -c "set session_replication_role = replica;
            delete from public.platform_image_deliveries where org_id = '$ORG';
            delete from public.kit_variacao_imagens where org_id = '$ORG';
            delete from public.platform_billing_statements where org_id = '$ORG';
            delete from public.platform_commercial_terms where org_id = '$ORG';
            delete from public.profiles where id = '$ADM';
            delete from auth.users where id = '$ADM';
            delete from public.organizations where id = '$ORG';" > /dev/null
  rm -f "$OUT_A"
}
MES="date_trunc('month', clock_timestamp() at time zone 'America/Fortaleza')::date"
imagem() {  # $1 = request_id
  echo "insert into public.kit_variacao_imagens (org_id, request_id, status, familia_base_id, cores, rotulo, modelo, storage_path, custo_usd)
        values ('$ORG', '$1', 'gerada', gen_random_uuid(), array['Preto','Branco'], 'Preto e Branco',
                'google/gemini-nano-banana-2.1', '$ORG/kit-variacao-ia/$1.png', 0.041)"
}

corrida() {
  local nome=$1
  psql_ -c "begin; $2; select pg_sleep(3); commit;" > "$OUT_A" 2>&1 &
  local pid=$!
  sleep 1
  local t0; t0=$(date +%s)
  set +e; B_OUT=$(psql_ -v VERBOSITY=verbose -c "$3" 2>&1); set -e
  DT=$(( $(date +%s) - t0 ))
  wait "$pid" || { cat "$OUT_A"; falha "$nome: sessão A falhou"; }
  echo "$nome: B=$B_OUT | B esperou ${DT}s"
  [ "$DT" -ge 1 ] || falha "$nome: B não bloqueou no lock de A"
  if echo "$B_OUT" | grep -q '40P01'; then falha "$nome: deadlock"; fi
}

limpar
trap limpar EXIT
psql_ -c "insert into public.organizations (id, nome, slug, modulos_habilitados, is_test)
            values ('$ORG', 'Imagem IA conc', 'imagem-ia-conc', array['kit_variacao','imagem_ia'], true);
          insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
            values ('$ADM', 'imagem-ia-conc@teste.local', '{}'::jsonb, '{\"org_id\":\"$ORG\"}'::jsonb);
          update public.profiles set is_super_admin = true, org_id = null, is_active = true where id = '$ADM';
          insert into public.platform_commercial_terms (org_id, starts_on, modality, monthly_fee_cents,
            revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4, sonar_unit_cents, image_unit_cents,
            setup_fee_cents, setup_due_month, reason, created_by, version)
          values ('$ORG', ($MES - interval '1 month')::date, 2, 0, 700, 600, 550, 500, 0, 50, 0, null, 'conc', '$ADM', 1);" > /dev/null

# 1. Fechamento (A: lock da org + demonstrativo da competência corrente, como o close na virada) × geração
#    (B): B espera o commit de A e grava na competência aberta seguinte, nunca na fechada.
R1=$(psql_ -c "select gen_random_uuid()")
corrida "1 fechamento×geração" \
  "select 1 from public.organizations where id = '$ORG' for update;
   insert into public.platform_billing_statements (org_id, month, terms_id, revenue_bps, gross_cents, refund_cents,
     base_cents, fee_cents, sonar_cents, credit_cents, total_cents, revision, snapshot, closed_by)
   select '$ORG', $MES, id, 700, 0, 0, 0, 0, 0, 0, 0, 'conc', '{}'::jsonb, '$ADM'
     from public.platform_commercial_terms where org_id = '$ORG'" \
  "$(imagem "$R1")"
M1=$(psql_ -c "select (month = ($MES + interval '1 month')::date) || '/' || units from public.platform_image_deliveries
               where org_id = '$ORG' and request_id = '$R1'")
[ "$M1" = 'true/1' ] || falha "1: entrega caiu em competência fechada ou não foi cobrada ($M1)"

# 2. Geração (A, segura o lock da org) × fechamento (B, mesmo lock): B espera e enxerga a entrega de A.
R2=$(psql_ -c "select gen_random_uuid()")
corrida "2 geração×fechamento" \
  "$(imagem "$R2")" \
  "select 1 from public.organizations where id = '$ORG' for update;
   select count(*) from public.platform_image_deliveries where org_id = '$ORG' and request_id = '$R2'"
[ "$(echo "$B_OUT" | tail -1)" = '1' ] || falha "2: o fechamento não viu a entrega commitada ($B_OUT)"

echo "platform_imagem_ia_concorrencia: OK"
