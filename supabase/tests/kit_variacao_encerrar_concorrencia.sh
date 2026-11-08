#!/usr/bin/env bash
# ADR-0200, emenda "Encerrar kit": corridas reais (duas sessões). A sessão A executa e SEGURA a transação 3 s; a B
# começa 1 s depois, tem de ESPERAR e decidir sobre o que A commitou. Mesmo arranjo de kit_variacao_guards_concorrencia.sh.
#
# Uso: bash supabase/tests/kit_variacao_encerrar_concorrencia.sh [container]
# Postgres LOCAL, nunca remoto, com o schema de produção e a migration 20261108154241 aplicada.
set -euo pipefail
C="${1:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)}"
ORG=97600000-0000-0000-0000-0000000000c1
USR=97600000-0000-0000-0000-0000000000c2
LOTE=97600000-0000-0000-0000-0000000000c3
OUT_A=$(mktemp)
psql_() { docker exec -i -e PGPASSWORD=postgres "$C" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
falha() { echo "FALHA: $*"; exit 1; }
limpar() {
  psql_ -c "delete from public.kit_exclusoes where org_id = '$ORG';
            delete from public.kit_transferencia_alvos where org_id = '$ORG';
            delete from public.estoque_movimentos where org_id = '$ORG';
            delete from public.kit_transferencias where org_id = '$ORG';
            delete from public.kit_pausas_automaticas where org_id = '$ORG';
            delete from public.sku_reivindicacoes_kit where org_id = '$ORG';
            delete from public.sku_politica_kit where org_id = '$ORG';
            delete from public.kit_marca_ml where org_id = '$ORG';
            alter table public.kit_variacao_componentes disable trigger kit_variacao_componentes_imutavel;
            delete from public.kit_variacao_componentes where org_id = '$ORG';
            alter table public.kit_variacao_componentes enable trigger kit_variacao_componentes_imutavel;
            delete from public.kit_variacao_skus where org_id = '$ORG';
            alter table public.kits_variacao disable trigger kits_variacao_guarda_encerrado;
            delete from public.kits_variacao where org_id = '$ORG';
            alter table public.kits_variacao enable trigger kits_variacao_guarda_encerrado;
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
                    where v.org_id = '$ORG' and v.codigo = '$1' order by f.criado_em desc, f.id desc limit 1"; }
status_kit() { psql_ -c "select status from public.kits_variacao where id = '$1'"; }

corrida() {
  local nome=$1
  psql_ -c "begin; $2; select pg_sleep(3); commit;" > "$OUT_A" 2>&1 &
  local pid=$!
  sleep 1
  local t0; t0=$(date +%s)
  set +e; B_OUT=$(psql_ -v VERBOSITY=verbose -c "$3" 2>&1); set -e
  DT=$(( $(date +%s) - t0 ))
  wait "$pid" || { cat "$OUT_A"; falha "$nome: sessão A falhou"; }
  A_OUT=$(grep -v '^$' "$OUT_A" | head -1 || true)
  echo "$nome: A=$A_OUT | B=$(echo "$B_OUT" | head -1) | B esperou ${DT}s"
  [ "$DT" -ge 1 ] || falha "$nome: B não bloqueou no lock de A"
  if echo "$B_OUT" | grep -q '40P01'; then falha "$nome: deadlock"; fi
}

# Kit n (n = 1..5): base 0997n000 (peças 0997n001 e 0997n002), kit 0998n000 com o SKU 0998n001 publicado (UP próprio).
kit() { echo "97600000-0000-0000-0000-00000000000$1"; }
limpar
trap limpar EXIT
psql_ -c "
  insert into public.organizations (id, nome, slug, modulos_habilitados, is_test)
  values ('$ORG', 'Kit encerrar conc', 'kit-encerrar-conc', array['kit_variacao'], true);
  insert into auth.users (id, email, raw_user_meta_data) values ('$USR', 'kit-encerrar-conc@teste.local', '{\"org_id\":\"$ORG\"}');
  insert into public.profiles (id, org_id, is_active) values ('$USR', '$ORG', true)
  on conflict (id) do update set org_id = excluded.org_id, is_active = true;
  insert into public.lotes (id, user_id, org_id, status, origem) values ('$LOTE', '$USR', '$ORG', 'processando', 'planilha');
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, criado_em, ml_item_id, status)
  select '$LOTE', '$USR', '$ORG', p, p, 'CREATE', 'nacional', gen_random_uuid(), now() - interval '1 day', 'MLB' || p, 'publicado'
  from (select '0997' || n || '000' p from generate_series(1, 5) n union all select '0998' || n || '000' from generate_series(1, 5) n) x;
  insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
  select f.id, '$USR', '$ORG', c, c, c, 'M', 50, 0
  from public.familias f
  cross join lateral (select case when f.codigo_pai like '0997%' then array[left(f.codigo_pai, 5) || '001', left(f.codigo_pai, 5) || '002']
                                  else array[left(f.codigo_pai, 5) || '001'] end cs) a
  cross join unnest(a.cs) c
  where f.org_id = '$ORG';
  insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco, status)
  select ('97600000-0000-0000-0000-00000000000' || n)::uuid, '$ORG', '0997' || n || '000', '0998' || n || '000', 2, 90, 'publicado'
  from generate_series(1, 5) n;
  insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
  select ('97600000-0000-0000-0000-00000000010' || n)::uuid, '$ORG', ('97600000-0000-0000-0000-00000000000' || n)::uuid,
         '0998' || n || '001', 'M', array['A', 'B'], 'A + B'
  from generate_series(1, 5) n;
  insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade)
  select ('97600000-0000-0000-0000-00000000010' || n)::uuid, '$ORG', '0997' || n || p, 1
  from generate_series(1, 5) n cross join (values ('001'), ('002')) x(p);
  insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, particao, status)
  select '$USR', '$ORG', 'mercado_livre', '0998' || n || '000', 0, 'publicado' from generate_series(1, 5) n;
  insert into public.anuncios_externos_itens (anuncio_externo_id, org_id, sku, item_externo_id, user_product_id, status)
  select a.id, '$ORG', left(a.codigo_pai, 5) || '001', 'MLB-K' || substr(a.codigo_pai, 5, 1), 'UP-K' || substr(a.codigo_pai, 5, 1), 'pausado'
  from public.anuncios_externos a where a.org_id = '$ORG';
  -- Kit 1 com 1 kit em saldo; kit 2 com uma venda antiga (entrada 1, venda 1: saldo 0, estornável).
  select public.registrar_entrada('$ORG', '09981001', 1, null, null, null, '$USR', 'conc:k1');
  select public.registrar_entrada('$ORG', '09982001', 1, null, null, null, '$USR', 'conc:k2');
  select public.baixar_estoque('$ORG', '09982001', 1, 'mercado_livre', 'mercado_livre:1:09982001');
" > /dev/null
versao() { psql_ -c "select versao from public.kits_variacao where id = '$1'"; }

# 1. Encerrar × venda: A baixa a última unidade do kit 1 e segura; B (encerrar) espera a variação e vê saldo 0.
corrida "encerrar×venda" \
  "select public.baixar_estoque('$ORG', '09981001', 1, 'mercado_livre', 'mercado_livre:2:09981001')" \
  "select public.kit_variacao_encerrar('$ORG', '$(kit 1)', $(versao "$(kit 1)"))->>'ok'"
[ "$B_OUT" = true ] || falha "encerrar×venda: B devia encerrar depois da baixa ($B_OUT)"
[ "$(status_kit "$(kit 1)")" = encerrando ] || falha "encerrar×venda: kit 1 não ficou encerrando"

# 2. Encerrar × montar: A encerra o kit 3 e segura; B tenta montar (gerenciar, versão lida antes) e espera o kit.
V3=$(versao "$(kit 3)")
corrida "encerrar×montar" \
  "select public.kit_variacao_encerrar('$ORG', '$(kit 3)', $V3)->>'ok'" \
  "select public.kit_variacao_gerenciar('$ORG', '$(kit 3)', 'montar', $V3, gen_random_uuid(), 'H', null,
     '[{\"codigo\":\"09983001\",\"quantidade\":1}]',
     '[{\"codigo\":\"09983001\",\"up_id\":\"UP-K3\",\"item_ids\":[\"MLB-K3\"]},{\"codigo\":\"09973001\",\"up_id\":\"UP-P3\",\"item_ids\":[\"MLB-P3\"]},{\"codigo\":\"09973002\",\"up_id\":\"UP-B3\",\"item_ids\":[\"MLB-B3\"]}]',
     false)->>'motivo'"
[ "$B_OUT" = versao ] || falha "encerrar×montar: B devia ser recusado pela versão ($B_OUT)"
# Mesmo sem o CAS da tela (transferência direta), a guarda recusa o kit encerrando.
set +e; D=$(psql_ -c "select public.kit_criar_transferencia('$ORG', '$(kit 3)', 'montar', '[{\"codigo\":\"09983001\",\"quantidade\":1}]',
  '[{\"codigo\":\"09983001\",\"up_id\":\"UP-K3\",\"item_ids\":[\"MLB-K3\"]},{\"codigo\":\"09973001\",\"up_id\":\"UP-P3\",\"item_ids\":[\"MLB-P3\"]},{\"codigo\":\"09973002\",\"up_id\":\"UP-B3\",\"item_ids\":[\"MLB-B3\"]}]')" 2>&1); set -e
echo "$D" | grep -q kit_encerrado || falha "montar direto em kit encerrando não foi recusado ($D)"
[ "$(psql_ -c "select count(*) from public.kit_transferencias where kit_id = '$(kit 3)'")" = 1 ] || falha "kit 3 ganhou outra transferência"
echo "montar direto em kit encerrando: recusado (kit_encerrado)"

# 3. Encerrar × estorno: A encerra o kit 2 (variação travada for share) e segura; B estorna a venda antiga e espera.
corrida "encerrar×estorno" \
  "select public.kit_variacao_encerrar('$ORG', '$(kit 2)', $(versao "$(kit 2)"))->>'ok'" \
  "select public.estornar_estoque('$ORG', 'mercado_livre', 'mercado_livre:1:09982001', '09982001') is not null"
[ "$(saldo 09982001)" = 1 ] || falha "encerrar×estorno: estorno devia creditar depois ($(saldo 09982001))"
[ "$(status_kit "$(kit 2)")" = encerrando ] || falha "encerrar×estorno: kit 2 não ficou encerrando"

# 4. Republicação × encerrar (ordem de locks, rodada 4 do Codex): A prepara a republicação da família do kit 4 e segura;
# B encerra e espera a exclusão. Depois do commit de A o vínculo sumiu: B recusa sem_vinculo, sem deadlock.
F4=$(psql_ -c "select id from public.familias where org_id = '$ORG' and codigo_pai = '09984000'")
corrida "republicar×encerrar" \
  "select count(*) from public.preparar_republicacao('$ORG', 'mercado_livre', '09984000', '$F4')" \
  "select public.kit_variacao_encerrar('$ORG', '$(kit 4)', $(versao "$(kit 4)"))->>'motivo'"
[ "$B_OUT" = sem_vinculo ] || falha "republicar×encerrar: B devia recusar sem_vinculo ($B_OUT)"

# 5. Encerrar × republicação (ordem inversa): o kit 3 já está encerrando (corrida 2); republicar a família dele é
# recusado pela exclusão da transferência `encerrar`.
set +e; R=$(psql_ -c "select count(*) from public.preparar_republicacao('$ORG', 'mercado_livre', '09983000',
  (select id from public.familias where org_id = '$ORG' and codigo_pai = '09983000'))" 2>&1); set -e
echo "$R" | grep -qE 'kit_em_transferencia|kit_encerrado' || falha "republicar kit encerrando devia recusar ($R)"
echo "republicar kit encerrando: recusado"

# 6. Encerrar sem vínculo × republicação (rodada 5 do Codex): o kit 4 (vínculo apagado na corrida 4) vira `erro` e
# encerra direto, soltando as exclusões na mesma transação. A republicação que esperava a exclusão insere depois do
# commit; a guarda (AFTER INSERT) lê `encerrado` e recusa.
psql_ -c "update public.kits_variacao set status = 'erro' where id = '$(kit 4)'" > /dev/null
corrida "encerrar×republicação (sem vínculo)" \
  "select public.kit_variacao_encerrar('$ORG', '$(kit 4)', $(versao "$(kit 4)"))->>'encerrado'" \
  "insert into public.kit_exclusoes (org_id, codigo, dono_tipo, dono_id) values ('$ORG', '09984001', 'republicacao', gen_random_uuid())"
echo "$B_OUT" | grep -q kit_encerrado || falha "republicação depois do encerramento devia recusar ($B_OUT)"
[ "$(status_kit "$(kit 4)")" = encerrado ] || falha "kit 4 devia estar encerrado"
# 7. Encerrar × publicação (rodada 6 do Codex): A encerra o kit 5 (kit FOR UPDATE, depois exclusões) e segura; B pega a
# exclusão de publicação do SKU do kit: a trava BEFORE espera o kit antes de pôr a linha (sem ciclo) e, depois do
# commit, a linha da transferência `encerrar` já está lá: B recusa sem deadlock.
corrida "encerrar×publicação" \
  "select public.kit_variacao_encerrar('$ORG', '$(kit 5)', $(versao "$(kit 5)"))->>'ok'" \
  "select public.kit_adquirir_exclusao('$ORG', array['09985001'], 'publicacao', gen_random_uuid())->>'ok'"
[ "$B_OUT" = false ] || falha "encerrar×publicação: B devia recusar ($B_OUT)"
[ "$(status_kit "$(kit 5)")" = encerrando ] || falha "kit 5 devia estar encerrando"
echo "OK: 7 corridas sem deadlock"
