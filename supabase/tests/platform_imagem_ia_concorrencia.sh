#!/usr/bin/env bash
# Task 16 (fix round 1, P1): virada do mês com duas sessões reais. A entrega de imagem IA (gatilho em
# kit_variacao_imagens) toma o MESMO lock da org que platform_billing_close. A sessão A segura a transação
# 3 s; a B começa 1 s depois, tem de ESPERAR e decidir sobre o que A commitou. Mesmo arranjo de
# kit_politica_operador_concorrencia.sh. Portão da Task 17 (Step 4b): NÃO executado nesta task.
#
# Galeria da cor (ADR-0201, Task 2): o mesmo arranjo pelo caminho da galeria (galeria_confirmar_exibicao →
# galeria_registrar_entrega → platform_imagem_competencia, mesmo lock da org) nas duas ordens, em org própria,
# e duas sessões travando o mesmo MLB sem linha (ml_travar_itens): exatamente uma vence.
#
# Uso: bash supabase/tests/platform_imagem_ia_concorrencia.sh [container]
# Postgres LOCAL, nunca remoto. Exige as migrations kit_variacao_*, 20261108094500 e 20261109093335_galeria_da_cor
# aplicadas no banco local.
set -euo pipefail
C="${1:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
ORG=97600000-0000-0000-0000-0000000000c1
ADM=97600000-0000-0000-0000-0000000000c2
ORG2=97600000-0000-0000-0000-0000000000c3
USR2=97600000-0000-0000-0000-0000000000c4
OUT_A=$(mktemp)
psql_() { docker exec -i -e PGPASSWORD=postgres "$C" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
falha() { echo "FALHA: $*"; exit 1; }
limpar() {
  # Entregas, termos e demonstrativos são append-only/imutáveis: replica desliga os gatilhos só nesta limpeza.
  psql_ -c "set session_replication_role = replica;
            do \$\$ begin if to_regclass('public.ml_item_travas') is not null then
              delete from public.ml_item_travas where org_id = '$ORG2';
              delete from public.galeria_imagens where org_id = '$ORG2';
              delete from public.galeria_pedidos where org_id = '$ORG2';
              delete from public.galeria_roteiros where org_id = '$ORG2';
            end if; end \$\$;
            delete from public.anuncios_externos where org_id = '$ORG2';
            delete from public.familias where org_id = '$ORG2';
            delete from public.lotes where org_id = '$ORG2';
            delete from public.platform_image_deliveries where org_id in ('$ORG', '$ORG2');
            delete from public.kit_variacao_imagens where org_id = '$ORG';
            delete from public.platform_billing_statements where org_id in ('$ORG', '$ORG2');
            delete from public.platform_commercial_terms where org_id in ('$ORG', '$ORG2');
            delete from public.profiles where id in ('$ADM', '$USR2');
            delete from auth.users where id in ('$ADM', '$USR2');
            delete from public.organizations where id in ('$ORG', '$ORG2');" > /dev/null
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

# ── Galeria da cor ──
[ "$(psql_ -c "select to_regprocedure('public.galeria_confirmar_exibicao(uuid,uuid,uuid[])') is not null")" = 't' ] \
  || falha "migration da galeria (20261109093335) não aplicada no banco local"
psql_ -c "insert into public.organizations (id, nome, slug, modulos_habilitados, is_test)
            values ('$ORG2', 'Galeria conc', 'galeria-conc', array['imagem_ia'], true);
          insert into auth.users (id, email, raw_user_meta_data)
            values ('$USR2', 'galeria-conc@teste.local', '{\"org_id\":\"$ORG2\"}'::jsonb);
          insert into public.profiles (id, org_id, is_active) values ('$USR2', '$ORG2', true)
            on conflict (id) do update set org_id = excluded.org_id, is_active = true;
          insert into public.platform_commercial_terms (org_id, starts_on, modality, monthly_fee_cents,
            revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4, sonar_unit_cents, image_unit_cents,
            setup_fee_cents, setup_due_month, reason, created_by, version)
          values ('$ORG2', ($MES - interval '1 month')::date, 2, 0, 700, 600, 550, 500, 0, 80, 0, null, 'conc', '$ADM', 1);
          with l as (insert into public.lotes (user_id, org_id, status, origem) values ('$USR2', '$ORG2', 'concluido', 'manual') returning id)
          insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, status)
          select id, '$USR2', '$ORG2', '09760000', '09760000', 'CREATE', 'nacional', gen_random_uuid(), 'publicado' from l;
          insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, particao, status)
          values ('$USR2', '$ORG2', 'mercado_livre', '09760000', 0, 'publicado');
          insert into public.galeria_roteiros (org_id, anuncio_externo_id, familia_id, versao, conteudo, fatos_hash, moda, status)
          select '$ORG2', a.id, f.id, 1, '{}'::jsonb, 'h1', false, 'aprovado'
            from public.anuncios_externos a, public.familias f where a.org_id = '$ORG2' and f.org_id = '$ORG2';" > /dev/null
AN2=$(psql_ -c "select id from public.anuncios_externos where org_id = '$ORG2'")
imagem_galeria() {  # $1 = cor; devolve o id da imagem já produzida (gerada, cena e custo)
  local pid; pid=$(psql_ -c "select gen_random_uuid()")
  psql_ -c "select count(*) from public.galeria_reservar_pedido(jsonb_build_object('id', '$pid',
              'org_id', '$ORG2', 'anuncio_externo_id', '$AN2', 'familia_id', (select familia_id from public.galeria_roteiros where org_id = '$ORG2'),
              'roteiro_id', (select id from public.galeria_roteiros where org_id = '$ORG2'), 'unit_cents', 50,
              'terms_id', (select id from public.platform_commercial_terms where org_id = '$ORG2'), 'elegivel', true,
              'itens', jsonb_build_array(jsonb_build_object('cor', '$1', 'missao', 1))))" > /dev/null
  psql_ -c "update public.galeria_imagens set status = 'gerada', cena_path = 'conc/' || id, custo_usd = 0.04
             where pedido_id = '$pid' returning id" | head -1
}
entrega_galeria() {  # $1 = imagem
  psql_ -c "select (d.month = ($MES + interval '1 month')::date) || '/' || d.units || '/' || d.unit_cents || '/' || d.origem
              from public.platform_image_deliveries d join public.galeria_imagens g on g.request_id = d.request_id
             where g.id = '$1'"
}

# 3. Fechamento (A) × confirmação de exibição da galeria (B): B espera e grava na competência seguinte, com o
#    preço do pedido (50, não o do termo).
G1=$(imagem_galeria Preto)
corrida "3 fechamento×galeria" \
  "select 1 from public.organizations where id = '$ORG2' for update;
   insert into public.platform_billing_statements (org_id, month, terms_id, revenue_bps, gross_cents, refund_cents,
     base_cents, fee_cents, sonar_cents, credit_cents, total_cents, revision, snapshot, closed_by)
   select '$ORG2', $MES, id, 700, 0, 0, 0, 0, 0, 0, 0, 'conc', '{}'::jsonb, '$ADM'
     from public.platform_commercial_terms where org_id = '$ORG2'" \
  "select public.galeria_confirmar_exibicao('$ORG2', '$AN2', array['$G1']::uuid[])"
[ "$(entrega_galeria "$G1")" = 'true/1/50/galeria' ] || falha "3: galeria caiu em competência fechada ($(entrega_galeria "$G1"))"

# 4. Confirmação da galeria (A, segura o lock da org) × fechamento (B): B espera e enxerga a entrega de A.
G2=$(imagem_galeria Branco)
corrida "4 galeria×fechamento" \
  "select public.galeria_confirmar_exibicao('$ORG2', '$AN2', array['$G2']::uuid[])" \
  "select 1 from public.organizations where id = '$ORG2' for update;
   select count(*) from public.platform_image_deliveries d join public.galeria_imagens g on g.request_id = d.request_id
    where g.id = '$G2'"
[ "$(echo "$B_OUT" | tail -1)" = '1' ] || falha "4: o fechamento não viu a entrega da galeria ($B_OUT)"

# 5. Duas sessões travando o mesmo MLB inicialmente sem linha: exatamente uma devolve true.
corrida "5 trava×trava" \
  "select public.ml_travar_itens('$ORG2', array['MLB-CONC'], 'escritor', gen_random_uuid(), 600)" \
  "select public.ml_travar_itens('$ORG2', array['MLB-CONC'], 'escritor', gen_random_uuid(), 600)"
[ "$(grep -x 't' "$OUT_A")" = 't' ] && [ "$(echo "$B_OUT" | tail -1)" = 'f' ] \
  || falha "5: as duas sessões venceram ou nenhuma (A=$(cat "$OUT_A") B=$B_OUT)"

echo "platform_imagem_ia_concorrencia: OK"
