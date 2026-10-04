-- ADR-0178 — RPCs do reajuste de preço em massa (reserva, confirmação, persistência e barreiras).
-- Run locally after applying the migrations:
-- docker exec -i supabase_db_<project-ref> psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/reajuste_preco.sql
-- Everything is rolled back.
\set ON_ERROR_STOP on
\set org '''93000000-0000-0000-0000-000000000001'''
\set org2 '''93000000-0000-0000-0000-000000000002'''
\set usr '''93000000-0000-0000-0000-000000000101'''
\set f1 '''93000000-0000-0000-0000-000000000301'''
\set f2 '''93000000-0000-0000-0000-000000000302'''
\set v1a '''93000000-0000-0000-0000-000000000401'''
\set v1b '''93000000-0000-0000-0000-000000000402'''
\set op1 '''93000000-0000-0000-0000-000000000501'''
\set opad '''93000000-0000-0000-0000-000000000502'''
\set oprv '''93000000-0000-0000-0000-000000000503'''
\set opr '''93000000-0000-0000-0000-000000000504'''
\set opx '''93000000-0000-0000-0000-000000000505'''
\set oppa '''93000000-0000-0000-0000-000000000506'''
\set opsa '''93000000-0000-0000-0000-000000000507'''
\set motpub '''Família em publicação/atualização — tente depois'''

begin;

create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if;
end $$;

insert into public.organizations (id, nome, slug) values
  (:org, 'Reajuste A', 'reajuste-test-a'), (:org2, 'Reajuste B', 'reajuste-test-b');
insert into auth.users (id, email, raw_user_meta_data) values
  (:usr, 'reajuste@test.local', '{"org_id":"93000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('93000000-0000-0000-0000-000000000201', :usr, :org, 'processando', 'manual'),
  ('93000000-0000-0000-0000-000000000202', :usr, :org, 'processando', 'manual');

-- F1: família Legacy publicada do produto PAI1 (MLBX), 2 cores.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id, publicado_em)
values (:f1, '93000000-0000-0000-0000-000000000201', :usr, :org, '09310001', 'Produto 1', 'CREATE', 'publicado', 'nacional',
        gen_random_uuid(), 'MLBX', now() - interval '1 day');
insert into public.variacoes (id, familia_id, user_id, org_id, codigo, nome, preco, preco_publicacao, preco_editado_pelo_operador, ml_variation_id) values
  (:v1a, :f1, :usr, :org, '09310011', 'A', 10, 100, false, 'VA'),
  (:v1b, :f1, :usr, :org, '09310012', 'B', 10, 200, true, 'VB');

-- Operação reajustar executando com item pendente do MLBX.
insert into public.operacoes_massa (id, org_id, acao, status) values (:op1, :org, 'reajustar', 'executando');
insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, codigo_pai, variacao_ids)
values (:op1, :org, 'MLBX', 'pendente', 110, '09310001', array[:v1a, :v1b]::uuid[]);

-- ── Resolução do produto (org-scoped) ─────────────────────────────────────────────────────────
select pg_temp.ok(public.reajuste_codigo_pai(:org, 'MLBX') = '09310001', 'resolve Legacy por familias.ml_item_id');
select pg_temp.ok(public.reajuste_codigo_pai(:org2, 'MLBX') is null, 'outra org não resolve');
select pg_temp.ok(public.reajuste_codigo_pai(:org, 'MLB-NADA') is null, 'desconhecido = null');

-- (a) claim ok → enviando; de novo → ocupado.
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'ok', '(a) ok');
select pg_temp.ok((select status = 'enviando' and codigo_pai = '09310001' from public.operacoes_massa_itens
                   where operacao_id = :op1 and ml_item_id = 'MLBX'), '(a) enviando + codigo_pai');
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'ocupado', '(a) ocupado');

-- (n) enviando RECENTE de outro worker + família publicando → ocupado, status intocado.
update public.familias set status = 'publicando' where id = :f1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'ocupado', '(n) ocupado');
select pg_temp.ok((select status = 'enviando' and mensagem is null from public.operacoes_massa_itens
                   where operacao_id = :op1 and ml_item_id = 'MLBX'), '(n) continua enviando');

-- (b) item claimável + F1 publicando → motivo, item gravado bloqueado pela própria RPC.
update public.operacoes_massa_itens set status = 'pendente' where operacao_id = :op1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = :motpub, '(b) motivo publicação');
select pg_temp.ok((select status = 'bloqueado' and mensagem = :motpub from public.operacoes_massa_itens
                   where operacao_id = :op1 and ml_item_id = 'MLBX'), '(b) bloqueado com mensagem');
update public.familias set status = 'publicado' where id = :f1;

-- (c) F2 NOVA do mesmo codigo_pai (outro lote) em publicando → motivo.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id)
values (:f2, '93000000-0000-0000-0000-000000000202', :usr, :org, '09310001', 'Produto 1', 'UPDATE', 'publicando', 'nacional',
        gen_random_uuid(), 'MLBX');
update public.operacoes_massa_itens set status = 'pendente', mensagem = null where operacao_id = :op1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = :motpub, '(c) F2 publicando → motivo');
update public.familias set status = 'pronto' where id = :f2;

-- (d) conferindo futuro → ocupado; vencido → ok com etapa preservada; com etapa + F1 publicando → ok.
update public.operacoes_massa_itens set status = 'conferindo', mensagem = null, etapa = 'escrita_pedida',
  proxima_conferencia = now() + interval '1 hour' where operacao_id = :op1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'ocupado', '(d) conferindo futuro → ocupado');
update public.operacoes_massa_itens set proxima_conferencia = now() - interval '1 minute' where operacao_id = :op1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'ok', '(d) conferindo vencido → ok');
select pg_temp.ok((select status = 'enviando' and etapa = 'escrita_pedida' from public.operacoes_massa_itens
                   where operacao_id = :op1), '(d) etapa preservada');
update public.operacoes_massa_itens set status = 'conferindo', etapa = 'ml_confirmado',
  proxima_conferencia = now() - interval '1 minute' where operacao_id = :op1;
update public.familias set status = 'publicando' where id = :f1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'ok', '(d) retomada com etapa não recusa');
select pg_temp.ok((select status = 'enviando' and etapa = 'ml_confirmado' from public.operacoes_massa_itens
                   where operacao_id = :op1), '(d) retomada preserva etapa');
-- enviando parado (> 2 min) → ok.
update public.operacoes_massa_itens set atualizado_em = now() - interval '3 minutes' where operacao_id = :op1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'ok', '(d) enviando parado → ok');
update public.familias set status = 'publicado' where id = :f1;
update public.operacoes_massa_itens set status = 'pendente', etapa = null, proxima_conferencia = null where operacao_id = :op1;

-- (e) familia_reservar_publicacao de F2 (mesmo produto) com reajuste ativo → motivo, F2 continua pronto.
select pg_temp.ok((select motivo = 'Há reajuste de preço em massa em andamento no anúncio MLBX' and id = :f2
                   from public.familia_reservar_publicacao(:org, array[:f2]::uuid[], 'UPDATE')), '(e) motivo');
select pg_temp.ok((select status = 'pronto' from public.familias where id = :f2), '(e) F2 continua pronto');
-- CREATE não casa F2 (UPDATE com ml_item_id) → nenhuma linha.
select pg_temp.ok((select count(*) = 0 from public.familia_reservar_publicacao(:org, array[:f2]::uuid[], 'CREATE')), '(e) filtro CREATE');
select pg_temp.ok((select count(*) = 0 from public.familia_reservar_publicacao(:org2, array[:f2]::uuid[], 'UPDATE')), '(e) outra org');
update public.operacoes_massa_itens set status = 'aplicado' where operacao_id = :op1;
select pg_temp.ok((select motivo is null and codigo_pai = '09310001' and lote_id = '93000000-0000-0000-0000-000000000202'
                   from public.familia_reservar_publicacao(:org, array[:f2]::uuid[], 'UPDATE')), '(e) sem reajuste → reserva');
select pg_temp.ok((select status = 'publicando' and erro_mensagem is null from public.familias where id = :f2), '(e) F2 publicando');
-- Família em `erro` também é reservável (filtro pronto/erro) e tem o erro limpo.
update public.familias set status = 'erro', erro_mensagem = 'falhou antes' where id = :f2;
select pg_temp.ok((select motivo is null from public.familia_reservar_publicacao(:org, array[:f2]::uuid[], 'UPDATE')), '(e) erro → reserva');
select pg_temp.ok((select status = 'publicando' and erro_mensagem is null from public.familias where id = :f2), '(e) erro → publicando, erro limpo');
update public.familias set status = 'pronto' where id = :f2;
-- CREATE positivo: família nova sem ml_item_id.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro)
values ('93000000-0000-0000-0000-000000000309', '93000000-0000-0000-0000-000000000201', :usr, :org, '09310009', 'P9', 'CREATE', 'pronto', 'nacional', gen_random_uuid());
select pg_temp.ok((select motivo is null and codigo_pai = '09310009'
                   from public.familia_reservar_publicacao(:org, array['93000000-0000-0000-0000-000000000309']::uuid[], 'CREATE')), '(e) CREATE → reserva');
select pg_temp.ok((select status = 'publicando' from public.familias where id = '93000000-0000-0000-0000-000000000309'), '(e) CREATE publicando');

-- (f)/(m) PxV: raiz ML partição 0 de PAI1, partição 1 de PAI1 e raiz ML de outro produto.
-- (m) "raiz de outro canal": o enum canal_externo só tem 'mercado_livre' — não construível; o
-- filtro canal='mercado_livre' fica no SQL e o teste cobre as outras raízes intocadas.
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai, particao, item_externo_id) values
  ('93000000-0000-0000-0000-000000000601', :usr, :org, 'mercado_livre', '09310001', 0, 'MLBX'),
  ('93000000-0000-0000-0000-000000000602', :usr, :org, 'mercado_livre', '09310001', 1, 'MLBX1'),
  ('93000000-0000-0000-0000-000000000603', :usr, :org, 'mercado_livre', '09319999', 0, 'MLBO');
select pg_temp.ok(public.reajuste_codigo_pai(:org, 'MLBX1') = '09310001', 'resolve partição por anuncios_externos.item_externo_id');
update public.operacoes_massa_itens set status = 'pendente' where operacao_id = :op1;
select pg_temp.ok(public.familia_reservar_migracao_pxv(:org, '09310001',
  '{"migracao_pxv_status":"solicitada","migracao_pxv_solicitada_em":"2026-10-04T12:00:00Z","migracao_pxv_snapshot":[{"id":"1"}],"migracao_pxv_erro":null,"migracao_pxv_tentativa":0,"ml_item_id_anterior":"MLBX"}')
  = 'Há reajuste de preço em massa em andamento no anúncio MLBX', '(f) motivo com reajuste ativo');
select pg_temp.ok((select migracao_pxv_status is null from public.anuncios_externos where id = '93000000-0000-0000-0000-000000000601'), '(f) raiz intocada');
update public.operacoes_massa_itens set status = 'aplicado' where operacao_id = :op1;
update public.anuncios_externos set migracao_pxv_erro = 'velho', migracao_pxv_tentativa = 3 where id = '93000000-0000-0000-0000-000000000601';
select pg_temp.ok(public.familia_reservar_migracao_pxv(:org, '09310001',
  '{"migracao_pxv_status":"solicitada","migracao_pxv_solicitada_em":"2026-10-04T12:00:00Z","migracao_pxv_snapshot":[{"id":"1"}],"migracao_pxv_erro":null,"migracao_pxv_tentativa":0,"ml_item_id_anterior":"MLBX"}')
  = 'ok', '(f) ok');
select pg_temp.ok((select migracao_pxv_status = 'solicitada' and migracao_pxv_solicitada_em = '2026-10-04T12:00:00Z'::timestamptz
                     and migracao_pxv_snapshot = '[{"id":"1"}]'::jsonb and migracao_pxv_erro is null
                     and migracao_pxv_tentativa = 0 and ml_item_id_anterior = 'MLBX'
                   from public.anuncios_externos where id = '93000000-0000-0000-0000-000000000601'), '(f) 6 campos gravados');
select pg_temp.ok((select count(*) = 2 from public.anuncios_externos
                   where id in ('93000000-0000-0000-0000-000000000602','93000000-0000-0000-0000-000000000603')
                     and migracao_pxv_status is null and ml_item_id_anterior is null), '(m) outras raízes intocadas');
select pg_temp.ok(public.familia_reservar_migracao_pxv(:org, '09310001', '{"migracao_pxv_status":"solicitada"}') = 'Migração já solicitada', '(f) repetida');
-- p_campos sem status → erro (nunca 'ok' gravando null).
do $$
begin
  perform public.familia_reservar_migracao_pxv('93000000-0000-0000-0000-000000000001', '09319999', '{"migracao_pxv_tentativa":0,"ml_item_id_anterior":"X"}');
  raise exception 'FALHA: (f) sem status devia lançar';
exception when raise_exception then
  if sqlerrm like 'FALHA:%' then raise; end if;
end $$;
select pg_temp.ok((select migracao_pxv_status is null and ml_item_id_anterior is null from public.anuncios_externos where id = '93000000-0000-0000-0000-000000000603'), '(f) sem status: raiz intocada');
-- Reajuste recusa migração em curso.
update public.operacoes_massa_itens set status = 'pendente' where operacao_id = :op1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'Migração para preço por variação em curso', '(f) reajuste recusa PxV');
select pg_temp.ok((select status = 'bloqueado' from public.operacoes_massa_itens where operacao_id = :op1), '(f) item bloqueado');
update public.anuncios_externos set migracao_pxv_status = 'em_andamento' where id = '93000000-0000-0000-0000-000000000601';
update public.operacoes_massa_itens set status = 'pendente', mensagem = null where operacao_id = :op1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'Migração para preço por variação em curso', '(f) reajuste recusa PxV em_andamento');
update public.anuncios_externos set migracao_pxv_status = null where id = '93000000-0000-0000-0000-000000000601';

-- (g) persistir ok → variações e item; de novo ja_aplicado.
update public.operacoes_massa_itens set status = 'conferindo', etapa = 'ml_confirmado', mensagem = null where operacao_id = :op1;
select pg_temp.ok(public.reajuste_persistir(:org, :op1, 'MLBX', 110, jsonb_build_array(
  jsonb_build_object('variacao_id', :v1a, 'esperado', '{"preco_publicacao":100,"preco_editado_pelo_operador":false}'::jsonb,
                     'novo', '{"preco_publicacao":110,"preco_editado_pelo_operador":true}'::jsonb),
  jsonb_build_object('variacao_id', :v1b, 'esperado', '{"preco_publicacao":200,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":220,"preco_editado_pelo_operador":true}'::jsonb))) = 'ok', '(g) ok');
select pg_temp.ok((select preco_publicacao = 110 and preco_editado_pelo_operador and preco_publicado_ml = 110 from public.variacoes where id = :v1a), '(g) v1a');
select pg_temp.ok((select preco_publicacao = 220 and preco_editado_pelo_operador and preco_publicado_ml = 110 from public.variacoes where id = :v1b), '(g) v1b');
select pg_temp.ok((select status = 'aplicado' and etapa is null and mensagem is null from public.operacoes_massa_itens where operacao_id = :op1), '(g) item aplicado');
select pg_temp.ok(public.reajuste_persistir(:org, :op1, 'MLBX', 110, '[]') = 'ja_aplicado', '(g) ja_aplicado');
-- Conflito na SEGUNDA cor → conflito e a primeira inalterada.
update public.operacoes_massa_itens set status = 'conferindo', etapa = 'ml_confirmado' where operacao_id = :op1;
select pg_temp.ok(public.reajuste_persistir(:org, :op1, 'MLBX', 120, jsonb_build_array(
  jsonb_build_object('variacao_id', :v1a, 'esperado', '{"preco_publicacao":110,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":120,"preco_editado_pelo_operador":true}'::jsonb),
  jsonb_build_object('variacao_id', :v1b, 'esperado', '{"preco_publicacao":999,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":230,"preco_editado_pelo_operador":true}'::jsonb))) = 'conflito', '(g) conflito 2ª cor');
select pg_temp.ok((select preco_publicacao = 110 and preco_publicado_ml = 110 from public.variacoes where id = :v1a), '(g) 1ª cor inalterada');
select pg_temp.ok((select preco_publicacao = 220 from public.variacoes where id = :v1b), '(g) 2ª cor inalterada');
select pg_temp.ok((select status = 'erro' and etapa is null and mensagem like 'Conflito:%' from public.operacoes_massa_itens where operacao_id = :op1), '(g) item erro');
-- Repetir depois do erro, com payload válido → estado_invalido, nada gravado.
select pg_temp.ok(public.reajuste_persistir(:org, :op1, 'MLBX', 120, jsonb_build_array(
  jsonb_build_object('variacao_id', :v1a, 'esperado', '{"preco_publicacao":110,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":120,"preco_editado_pelo_operador":true}'::jsonb),
  jsonb_build_object('variacao_id', :v1b, 'esperado', '{"preco_publicacao":220,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":230,"preco_editado_pelo_operador":true}'::jsonb))) = 'estado_invalido', '(g) após erro → estado_invalido');
select pg_temp.ok((select count(*) = 2 from public.variacoes where id in (:v1a, :v1b) and preco_publicacao in (110, 220) and preco_publicado_ml = 110), '(g) estado_invalido: nada gravado');
select pg_temp.ok((select status = 'erro' and mensagem like 'Conflito:%' from public.operacoes_massa_itens where operacao_id = :op1), '(g) estado_invalido: item intacto');
-- Variação inexistente (no item e no p_restaurar) → conflito.
update public.operacoes_massa_itens set status = 'conferindo', variacao_ids = array[:v1a, '93000000-0000-0000-0000-000000000499']::uuid[] where operacao_id = :op1;
select pg_temp.ok(public.reajuste_persistir(:org, :op1, 'MLBX', 120, jsonb_build_array(
  jsonb_build_object('variacao_id', :v1a, 'esperado', '{"preco_publicacao":110,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":120,"preco_editado_pelo_operador":true}'::jsonb),
  jsonb_build_object('variacao_id', '93000000-0000-0000-0000-000000000499', 'esperado', '{"preco_publicacao":1,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":2,"preco_editado_pelo_operador":true}'::jsonb))) = 'conflito', '(g) variação inexistente');
select pg_temp.ok((select preco_publicacao = 110 from public.variacoes where id = :v1a), '(g) inexistente: 1ª inalterada');

-- (k) completude: omite a 2ª cor / vazio / duplicata → conflito, nenhuma variação alterada.
update public.operacoes_massa_itens set status = 'conferindo', variacao_ids = array[:v1a, :v1b]::uuid[] where operacao_id = :op1;
select pg_temp.ok(public.reajuste_persistir(:org, :op1, 'MLBX', 120, jsonb_build_array(
  jsonb_build_object('variacao_id', :v1a, 'esperado', '{"preco_publicacao":110,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":120,"preco_editado_pelo_operador":true}'::jsonb))) = 'conflito', '(k) omitindo 2ª cor');
select pg_temp.ok((select preco_publicacao = 110 from public.variacoes where id = :v1a), '(k) omitindo: nada alterado');
select pg_temp.ok((select status = 'erro' and mensagem = 'Conjunto de variações do anúncio não confere com o preview — nada foi gravado no banco'
                   from public.operacoes_massa_itens where operacao_id = :op1), '(k) mensagem própria da completude');
update public.operacoes_massa_itens set status = 'conferindo' where operacao_id = :op1;
select pg_temp.ok(public.reajuste_persistir(:org, :op1, 'MLBX', 120, '[]') = 'conflito', '(k) vazio');
update public.operacoes_massa_itens set status = 'conferindo' where operacao_id = :op1;
select pg_temp.ok(public.reajuste_persistir(:org, :op1, 'MLBX', 120, jsonb_build_array(
  jsonb_build_object('variacao_id', :v1a, 'esperado', '{"preco_publicacao":110,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":120,"preco_editado_pelo_operador":true}'::jsonb),
  jsonb_build_object('variacao_id', :v1a, 'esperado', '{"preco_publicacao":110,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":120,"preco_editado_pelo_operador":true}'::jsonb),
  jsonb_build_object('variacao_id', :v1b, 'esperado', '{"preco_publicacao":220,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":230,"preco_editado_pelo_operador":true}'::jsonb))) = 'conflito', '(k) duplicata');
select pg_temp.ok((select count(*) = 2 from public.variacoes where id in (:v1a, :v1b) and preco_publicacao in (110, 220)), '(k) nada alterado');
update public.operacoes_massa_itens set status = 'aplicado', mensagem = null where operacao_id = :op1;

-- (h) aderir: barreira do reajuste; pausar/sair idênticos ao atual.
insert into public.operacoes_massa (id, org_id, acao, promocao_id, promocao_tipo, status) values
  (:opad, :org, 'aderir', 'P1', 'DEAL', 'executando'), (:opsa, :org, 'sair', 'P2', 'DEAL', 'executando');
insert into public.operacoes_massa (id, org_id, acao, status) values (:oppa, :org, 'pausar', 'executando');
insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, status) values
  (:opad, :org, 'P1', 'MLBX', 'pendente'), (:opsa, :org, 'P2', 'MLBX', 'pendente');
insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status) values (:oppa, :org, 'MLBPAUSA', 'pendente');
update public.operacoes_massa_itens set status = 'pendente' where operacao_id = :op1;  -- reajuste ativo no MLBX
select pg_temp.ok(not public.operacoes_massa_reivindicar(:org, :opad, 'MLBX'), '(h) aderir pendente + reajuste → false');
select pg_temp.ok((select status = 'mudou' and mensagem = 'Reajuste de preço em andamento neste anúncio'
                   from public.operacoes_massa_itens where operacao_id = :opad), '(h) aderir → mudou');
update public.operacoes_massa_itens set status = 'enviando', mensagem = null, atualizado_em = now() where operacao_id = :opad;
select pg_temp.ok(not public.operacoes_massa_reivindicar(:org, :opad, 'MLBX'), '(h) aderir enviando recente → false');
select pg_temp.ok((select status = 'enviando' and mensagem is null from public.operacoes_massa_itens where operacao_id = :opad), '(h) continua enviando');
-- sair NÃO tem barreira (corpo atual): reajuste ativo e mesmo assim reivindica.
select pg_temp.ok(public.operacoes_massa_reivindicar(:org, :opsa, 'MLBX'), '(h) sair inalterado → true');
select pg_temp.ok(not public.operacoes_massa_reivindicar(:org, :opsa, 'MLBX'), '(h) sair 2ª vez → false');
update public.operacoes_massa_itens set status = 'aplicado' where operacao_id = :op1;
update public.operacoes_massa_itens set status = 'pendente' where operacao_id = :opad;
select pg_temp.ok(public.operacoes_massa_reivindicar(:org, :opad, 'MLBX'), '(h) aderir sem reajuste → true');
select pg_temp.ok((select status = 'enviando' from public.operacoes_massa_itens where operacao_id = :opad), '(h) aderir enviando');
select pg_temp.ok(not public.operacoes_massa_reivindicar(:org, :opad, 'MLBX'), '(h) aderir 2ª vez → false');
update public.operacoes_massa_itens set atualizado_em = now() - interval '3 minutes' where operacao_id = :opad;
select pg_temp.ok(public.operacoes_massa_reivindicar(:org, :opad, 'MLBX'), '(h) aderir parado → true');
select pg_temp.ok(public.operacoes_massa_reivindicar(:org, :oppa, 'MLBPAUSA'), '(h) pausar → true');
select pg_temp.ok(not public.operacoes_massa_reivindicar(:org, :oppa, 'MLBPAUSA'), '(h) pausar 2ª → false');
select pg_temp.ok(not public.operacoes_massa_reivindicar(:org2, :oppa, 'MLBPAUSA'), '(h) outra org → false');
update public.operacoes_massa_itens set atualizado_em = now() - interval '3 minutes' where operacao_id = :oppa;
select pg_temp.ok(public.operacoes_massa_reivindicar(:org, :oppa, 'MLBPAUSA'), '(h) pausar parado → true');
-- reajuste recusa MLB com item de promoção em andamento (aderir enviando).
update public.operacoes_massa_itens set status = 'pendente' where operacao_id = :op1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'Anúncio em operação de promoção em andamento', '(h) reajuste recusa promoção');
-- Só o `sair` ativo (enviando) e depois em saida_solicitada também recusam.
update public.operacoes_massa_itens set status = 'aplicado' where operacao_id = :opad;
update public.operacoes_massa_itens set status = 'enviando' where operacao_id = :opsa;
update public.operacoes_massa_itens set status = 'pendente', mensagem = null where operacao_id = :op1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'Anúncio em operação de promoção em andamento', '(h) recusa por sair enviando');
update public.operacoes_massa_itens set status = 'saida_solicitada' where operacao_id = :opsa;
update public.operacoes_massa_itens set status = 'pendente', mensagem = null where operacao_id = :op1;
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLBX') = 'Anúncio em operação de promoção em andamento', '(h) recusa por saida_solicitada');
update public.operacoes_massa_itens set status = 'aplicado' where operacao_id in (:opad, :opsa);
update public.operacoes_massa_itens set status = 'aplicado', mensagem = null where operacao_id = :op1;

-- (i) Reverter: variação editada depois do reajuste → Não revertível (item mudou); intacta → ok.
insert into public.operacoes_massa (id, org_id, acao, status, origem_id) values (:oprv, :org, 'reajustar', 'executando', :op1);
insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, codigo_pai, variacao_ids, estado_anterior)
values (:oprv, :org, 'MLBX', 'pendente', 100, '09310001', array[:v1a]::uuid[], jsonb_build_array(
  jsonb_build_object('variacao_id', :v1a, 'esperado', '{"preco_publicacao":110,"preco_editado_pelo_operador":true}'::jsonb,
                     'novo', '{"preco_publicacao":100,"preco_editado_pelo_operador":false}'::jsonb)));
update public.variacoes set preco_publicacao = 150 where id = :v1a;
select pg_temp.ok(public.reajuste_reivindicar(:org, :oprv, 'MLBX') = 'Não revertível: o preço mudou depois do reajuste', '(i) motivo');
select pg_temp.ok((select status = 'mudou' and mensagem like 'Não revertível%' from public.operacoes_massa_itens where operacao_id = :oprv), '(i) mudou');
update public.variacoes set preco_publicacao = 110 where id = :v1a;
update public.operacoes_massa_itens set status = 'pendente', mensagem = null where operacao_id = :oprv;
select pg_temp.ok(public.reajuste_reivindicar(:org, :oprv, 'MLBX') = 'ok', '(i) intacta → ok');
update public.operacoes_massa_itens set status = 'aplicado' where operacao_id = :oprv;

-- Não encontrado nesta org → bloqueado com o motivo.
update public.operacoes_massa_itens set status = 'pendente' where operacao_id = :op1;
insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status) values (:op1, :org, 'MLB-NADA', 'pendente');
select pg_temp.ok(public.reajuste_reivindicar(:org, :op1, 'MLB-NADA') = 'Anúncio não encontrado nesta organização', 'não encontrado');
select pg_temp.ok((select status = 'bloqueado' from public.operacoes_massa_itens where operacao_id = :op1 and ml_item_id = 'MLB-NADA'), 'não encontrado → bloqueado');
-- Outra org: não resolve o produto e não enxerga o item → ocupado (nada a gravar).
select pg_temp.ok(public.reajuste_reivindicar(:org2, :op1, 'MLBX') = 'ocupado', 'outra org não acha');
select pg_temp.ok((select status = 'pendente' from public.operacoes_massa_itens where operacao_id = :op1 and ml_item_id = 'MLBX'), 'outra org não altera');
update public.operacoes_massa_itens set status = 'aplicado' where operacao_id = :op1;

-- (j) reajuste_confirmar.
insert into public.operacoes_massa (id, org_id, acao, status, expira_em) values (:opr, :org, 'reajustar', 'rascunho', now() + interval '30 minutes');
-- MLBJ1/MLBJ2 já trazem codigo_pai do preview; MLBJ3 não — o confirmar resolve pela família 306.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id, publicado_em)
values ('93000000-0000-0000-0000-000000000306', '93000000-0000-0000-0000-000000000201', :usr, :org, '09310006', 'P6', 'UPDATE', 'pronto', 'nacional',
        gen_random_uuid(), 'MLBJ3', now());
insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, avaliacao, codigo_pai) values
  (:opr, :org, 'MLBJ1', 'rascunho', '{"tem_vermelho":false,"tem_sem_dado":false}', '09310007'),
  (:opr, :org, 'MLBJ2', 'rascunho', '{"tem_vermelho":true,"tem_sem_dado":false}', '09310007'),
  (:opr, :org, 'MLBJ3', 'rascunho', '{"tem_vermelho":false,"tem_sem_dado":true}', null);
create temp table snap as select ml_item_id, status, incluido, confirmado_risco, confirmado_sem_dado, mensagem
  from public.operacoes_massa_itens where operacao_id = :opr;
create function pg_temp.intacto() returns boolean language sql as $$
  select (select status from public.operacoes_massa where id = '93000000-0000-0000-0000-000000000504') = 'rascunho'
     and not exists (select ml_item_id, status, incluido, confirmado_risco, confirmado_sem_dado, mensagem
                       from public.operacoes_massa_itens where operacao_id = '93000000-0000-0000-0000-000000000504'
                     except select * from snap)
$$;
-- 🔴 incluído sem risco, sendo o SEGUNDO item → faltando, nada alterado.
select pg_temp.ok(public.reajuste_confirmar(:org, :opr, '[{"ml_item_id":"MLBJ1","incluir":true},{"ml_item_id":"MLBJ2","incluir":true},{"ml_item_id":"MLBJ3","incluir":true,"sem_dado":true}]')
  = 'confirmacao_faltando:MLBJ2', '(j) faltando risco');
select pg_temp.ok(pg_temp.intacto(), '(j) faltando: nada alterado');
select pg_temp.ok(public.reajuste_confirmar(:org, :opr, '[{"ml_item_id":"MLBJ2","incluir":true,"risco":true}]')
  = 'confirmacao_faltando:MLBJ3', '(j) faltando sem_dado (ausente mantém incluido)');
select pg_temp.ok(pg_temp.intacto(), '(j) faltando sem_dado: nada alterado');
select pg_temp.ok(public.reajuste_confirmar(:org, :opr, '[{"ml_item_id":"MLBJ1","incluir":false},{"ml_item_id":"MLBJ2","incluir":false},{"ml_item_id":"MLBJ3","incluir":false}]')
  = 'nenhum', '(j) nenhum');
select pg_temp.ok(pg_temp.intacto(), '(j) nenhum: nada alterado');
select pg_temp.ok(public.reajuste_confirmar(:org2, :opr, '[]') = 'nenhum', '(j) outra org → nenhum');
update public.operacoes_massa set expira_em = now() - interval '1 minute' where id = :opr;
select pg_temp.ok(public.reajuste_confirmar(:org, :opr, '[{"ml_item_id":"MLBJ2","risco":true},{"ml_item_id":"MLBJ3","sem_dado":true}]') = 'expirado', '(j) expirado');
update public.operacoes_massa set expira_em = now() + interval '30 minutes' where id = :opr;
-- Colisão de índice no ÚLTIMO item (MLBJ3) → P0001 ocupado:MLBJ3; nada alterado (fase 2 desfeita).
insert into public.operacoes_massa (id, org_id, acao, status) values (:opx, :org, 'reajustar', 'executando');
insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status) values (:opx, :org, 'MLBJ3', 'conferindo');
do $$
begin
  perform public.reajuste_confirmar('93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000504',
    '[{"ml_item_id":"MLBJ2","risco":true},{"ml_item_id":"MLBJ3","sem_dado":true}]');
  raise exception 'FALHA: (j) colisão devia lançar';
exception when sqlstate 'P0001' then
  if sqlerrm <> 'ocupado:MLBJ3' then raise exception 'FALHA: (j) colisão msg=%', sqlerrm; end if;
end $$;
select pg_temp.ok(pg_temp.intacto(), '(j) colisão: nada alterado (rascunho)');
delete from public.operacoes_massa where id = :opx;
-- ok: MLBJ1 desmarcado, MLBJ2 com risco, MLBJ3 com sem_dado.
select pg_temp.ok(public.reajuste_confirmar(:org, :opr, '[{"ml_item_id":"MLBJ1","incluir":false},{"ml_item_id":"MLBJ2","incluir":true,"risco":true},{"ml_item_id":"MLBJ3","sem_dado":true}]') = 'ok', '(j) ok');
select pg_temp.ok((select status = 'bloqueado' and mensagem = 'Desmarcado no preview' and not incluido from public.operacoes_massa_itens where operacao_id = :opr and ml_item_id = 'MLBJ1'), '(j) MLBJ1 bloqueado');
select pg_temp.ok((select status = 'pendente' and incluido and confirmado_risco from public.operacoes_massa_itens where operacao_id = :opr and ml_item_id = 'MLBJ2'), '(j) MLBJ2 pendente');
select pg_temp.ok((select status = 'pendente' and incluido and confirmado_sem_dado from public.operacoes_massa_itens where operacao_id = :opr and ml_item_id = 'MLBJ3'), '(j) MLBJ3 pendente');
select pg_temp.ok((select status = 'executando' and expira_em is null from public.operacoes_massa where id = :opr), '(j) operação executando');
-- A reserva nasce no confirmar: codigo_pai resolvido, visível para publicação.
select pg_temp.ok((select codigo_pai = '09310006' from public.operacoes_massa_itens where operacao_id = :opr and ml_item_id = 'MLBJ3'), '(j) codigo_pai resolvido');
select pg_temp.ok(public.reajuste_ativo_produto(:org, '09310006') = 'MLBJ3', '(j) reajuste_ativo_produto vê o confirmado');
select pg_temp.ok((select motivo = 'Há reajuste de preço em massa em andamento no anúncio MLBJ3'
                   from public.familia_reservar_publicacao(:org, array['93000000-0000-0000-0000-000000000306']::uuid[], 'UPDATE')), '(j) publicação recusa após confirmar');
select pg_temp.ok((select status = 'pronto' from public.familias where id = '93000000-0000-0000-0000-000000000306'), '(j) família continua pronto');
select pg_temp.ok(public.reajuste_confirmar(:org, :opr, '[]') = 'ja_confirmada', '(j) ja_confirmada');
update public.operacoes_massa set status = 'concluida' where id = :opr;
select pg_temp.ok(public.reajuste_confirmar(:org, :opr, '[]') = 'nenhum', '(j) concluida → nenhum');
-- Produto não resolvível (último item) → P0001 sem_produto:<ml>; nada alterado (o 1º item já tinha sido escrito).
insert into public.operacoes_massa (id, org_id, acao, status, expira_em) values
  ('93000000-0000-0000-0000-000000000508', :org, 'reajustar', 'rascunho', now() + interval '30 minutes');
insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, avaliacao, codigo_pai) values
  ('93000000-0000-0000-0000-000000000508', :org, 'MLBA0', 'rascunho', '{}', '09310008'),
  ('93000000-0000-0000-0000-000000000508', :org, 'MLBZZ', 'rascunho', '{}', null);
do $$
begin
  perform public.reajuste_confirmar('93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000508', '[]');
  raise exception 'FALHA: (j) sem_produto devia lançar';
exception when sqlstate 'P0001' then
  if sqlerrm <> 'sem_produto:MLBZZ' then raise exception 'FALHA: (j) sem_produto msg=%', sqlerrm; end if;
end $$;
select pg_temp.ok((select status = 'rascunho' from public.operacoes_massa where id = '93000000-0000-0000-0000-000000000508')
                  and (select count(*) = 2 from public.operacoes_massa_itens where operacao_id = '93000000-0000-0000-0000-000000000508' and status = 'rascunho'),
                  '(j) sem_produto: nada alterado');

-- (l) reajuste_variacoes_do_mlb.
-- PAI2: G1 antiga (A/B), G2 nova de reposição parcial (só A), ambas com ml_variation_id.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id, publicado_em) values
  ('93000000-0000-0000-0000-000000000311', '93000000-0000-0000-0000-000000000201', :usr, :org, '09310002', 'P2', 'CREATE', 'publicado', 'nacional', gen_random_uuid(), 'MLBY', now() - interval '2 days'),
  ('93000000-0000-0000-0000-000000000312', '93000000-0000-0000-0000-000000000202', :usr, :org, '09310002', 'P2', 'UPDATE', 'publicado', 'nacional', gen_random_uuid(), 'MLBY', now() - interval '1 day');
insert into public.variacoes (id, familia_id, user_id, org_id, codigo, nome, preco, ml_variation_id) values
  ('93000000-0000-0000-0000-000000000411', '93000000-0000-0000-0000-000000000311', :usr, :org, '09310021', 'A', 10, 'YA'),
  ('93000000-0000-0000-0000-000000000412', '93000000-0000-0000-0000-000000000311', :usr, :org, '09310022', 'B', 10, 'YB'),
  ('93000000-0000-0000-0000-000000000413', '93000000-0000-0000-0000-000000000312', :usr, :org, '09310021', 'A', 10, 'YA');
select pg_temp.ok((select variacao_id = '93000000-0000-0000-0000-000000000413' from public.reajuste_variacoes_do_mlb(:org, '09310002', 'MLBY', array['YA','YB','YZ']) where ml_variation_id = 'YA'), '(l) A da nova');
select pg_temp.ok((select variacao_id = '93000000-0000-0000-0000-000000000412' from public.reajuste_variacoes_do_mlb(:org, '09310002', 'MLBY', array['YA','YB','YZ']) where ml_variation_id = 'YB'), '(l) B da antiga');
select pg_temp.ok((select variacao_id is null from public.reajuste_variacoes_do_mlb(:org, '09310002', 'MLBY', array['YA','YB','YZ']) where ml_variation_id = 'YZ'), '(l) desconhecido → null');
select pg_temp.ok((select count(*) = 3 from public.reajuste_variacoes_do_mlb(:org, '09310002', 'MLBY', array['YA','YB','YZ'])), '(l) uma linha por id');
select pg_temp.ok((select bool_and(variacao_id is null) from public.reajuste_variacoes_do_mlb(:org2, '09310002', 'MLBY', array['YA'])), '(l) outra org → null');
-- Plano: 1 variação publicada → ela; 2 → null.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id, publicado_em) values
  ('93000000-0000-0000-0000-000000000321', '93000000-0000-0000-0000-000000000201', :usr, :org, '09310003', 'P3', 'CREATE', 'publicado', 'nacional', gen_random_uuid(), 'MLBP3', now()),
  ('93000000-0000-0000-0000-000000000322', '93000000-0000-0000-0000-000000000201', :usr, :org, '09310004', 'P4', 'CREATE', 'publicado', 'nacional', gen_random_uuid(), 'MLBP4', now());
insert into public.variacoes (id, familia_id, user_id, org_id, codigo, nome, preco, excluida_da_publicacao) values
  ('93000000-0000-0000-0000-000000000421', '93000000-0000-0000-0000-000000000321', :usr, :org, '09310031', 'U', 10, false),
  ('93000000-0000-0000-0000-000000000424', '93000000-0000-0000-0000-000000000321', :usr, :org, '09310032', 'X', 10, true),
  ('93000000-0000-0000-0000-000000000422', '93000000-0000-0000-0000-000000000322', :usr, :org, '09310041', 'A', 10, false),
  ('93000000-0000-0000-0000-000000000423', '93000000-0000-0000-0000-000000000322', :usr, :org, '09310042', 'B', 10, false);
select pg_temp.ok((select count(*) = 1 and bool_and(variacao_id = '93000000-0000-0000-0000-000000000421' and ml_variation_id is null)
                   from public.reajuste_variacoes_do_mlb(:org, '09310003', 'MLBP3', '{}')), '(l) plano → variação única');
select pg_temp.ok((select count(*) = 1 and bool_and(variacao_id is null) from public.reajuste_variacoes_do_mlb(:org, '09310004', 'MLBP4', '{}')), '(l) plano com 2 → null');
-- UP: anuncios_externos_itens.variacao_id; fallback por sku = variacoes.codigo.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, publicado_em) values
  ('93000000-0000-0000-0000-000000000331', '93000000-0000-0000-0000-000000000201', :usr, :org, '09310005', 'P5', 'CREATE', 'publicado', 'nacional', gen_random_uuid(), now());
insert into public.variacoes (id, familia_id, user_id, org_id, codigo, nome, preco) values
  ('93000000-0000-0000-0000-000000000431', '93000000-0000-0000-0000-000000000331', :usr, :org, '09310051', 'A', 10),
  ('93000000-0000-0000-0000-000000000432', '93000000-0000-0000-0000-000000000331', :usr, :org, '09310052', 'B', 10);
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai, particao) values
  ('93000000-0000-0000-0000-000000000631', :usr, :org, 'mercado_livre', '09310005', 0);
insert into public.anuncios_externos_itens (anuncio_externo_id, org_id, variacao_id, sku, status, item_externo_id) values
  ('93000000-0000-0000-0000-000000000631', :org, '93000000-0000-0000-0000-000000000431', '09310051', 'ativo', 'MLBU1'),
  ('93000000-0000-0000-0000-000000000631', :org, null, '09310052', 'ativo', 'MLBU2');
select pg_temp.ok(public.reajuste_codigo_pai(:org, 'MLBU1') = '09310005', 'resolve UP por anuncios_externos_itens');
select pg_temp.ok((select count(*) = 1 and bool_and(variacao_id = '93000000-0000-0000-0000-000000000431') from public.reajuste_variacoes_do_mlb(:org, '09310005', 'MLBU1', '{}')), '(l) UP → variacao_id do item');
select pg_temp.ok((select count(*) = 1 and bool_and(variacao_id = '93000000-0000-0000-0000-000000000432') from public.reajuste_variacoes_do_mlb(:org, '09310005', 'MLBU2', '{}')), '(l) UP fallback por sku');

-- (o) vínculo removido (Remover: familias.ml_item_id zerado, anuncios_externos apagado) com o item em retomada.
-- Com etapa (ML já escrito) → claim ok pelo codigo_pai do item e persistir ok; sem etapa → recusa.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, status, origem, chave_cadastro, ml_item_id, publicado_em) values
  ('93000000-0000-0000-0000-000000000341', '93000000-0000-0000-0000-000000000201', :usr, :org, '09310077', 'P7', 'CREATE', 'publicado', 'nacional', gen_random_uuid(), 'MLBR', now()),
  ('93000000-0000-0000-0000-000000000342', '93000000-0000-0000-0000-000000000201', :usr, :org, '09310078', 'P8', 'CREATE', 'publicado', 'nacional', gen_random_uuid(), 'MLBS', now());
insert into public.variacoes (id, familia_id, user_id, org_id, codigo, nome, preco, preco_publicacao, preco_editado_pelo_operador) values
  ('93000000-0000-0000-0000-000000000441', '93000000-0000-0000-0000-000000000341', :usr, :org, '09310071', 'U', 10, 50, false);
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai, particao, item_externo_id) values
  ('93000000-0000-0000-0000-000000000641', :usr, :org, 'mercado_livre', '09310077', 0, 'MLBR');
insert into public.operacoes_massa (id, org_id, acao, status) values ('93000000-0000-0000-0000-000000000509', :org, 'reajustar', 'executando');
insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, etapa, proxima_conferencia, preco, codigo_pai, variacao_ids) values
  ('93000000-0000-0000-0000-000000000509', :org, 'MLBR', 'conferindo', 'ml_confirmado', now() - interval '1 minute', 55, '09310077',
   array['93000000-0000-0000-0000-000000000441']::uuid[]),
  ('93000000-0000-0000-0000-000000000509', :org, 'MLBS', 'pendente', null, null, 66, '09310078', null);
update public.familias set ml_item_id = null where id in ('93000000-0000-0000-0000-000000000341', '93000000-0000-0000-0000-000000000342');
delete from public.anuncios_externos where id = '93000000-0000-0000-0000-000000000641';
select pg_temp.ok(public.reajuste_codigo_pai(:org, 'MLBR') is null and public.reajuste_codigo_pai(:org, 'MLBS') is null, '(o) vínculos removidos');
select pg_temp.ok(public.reajuste_reivindicar(:org, '93000000-0000-0000-0000-000000000509', 'MLBR') = 'ok', '(o) com etapa → ok');
select pg_temp.ok((select status = 'enviando' and etapa = 'ml_confirmado' and codigo_pai = '09310077' from public.operacoes_massa_itens
                   where operacao_id = '93000000-0000-0000-0000-000000000509' and ml_item_id = 'MLBR'), '(o) enviando, etapa e codigo_pai preservados');
select pg_temp.ok(public.reajuste_persistir(:org, '93000000-0000-0000-0000-000000000509', 'MLBR', 55, jsonb_build_array(
  jsonb_build_object('variacao_id', '93000000-0000-0000-0000-000000000441', 'esperado', '{"preco_publicacao":50,"preco_editado_pelo_operador":false}'::jsonb,
                     'novo', '{"preco_publicacao":55,"preco_editado_pelo_operador":true}'::jsonb))) = 'ok', '(o) persistir ok');
select pg_temp.ok((select preco_publicacao = 55 and preco_editado_pelo_operador and preco_publicado_ml = 55 from public.variacoes
                   where id = '93000000-0000-0000-0000-000000000441'), '(o) variação gravada');
select pg_temp.ok((select status = 'aplicado' from public.operacoes_massa_itens
                   where operacao_id = '93000000-0000-0000-0000-000000000509' and ml_item_id = 'MLBR'), '(o) item aplicado');
select pg_temp.ok(public.reajuste_reivindicar(:org, '93000000-0000-0000-0000-000000000509', 'MLBS') = 'Anúncio não encontrado nesta organização', '(o) sem etapa → recusa');
select pg_temp.ok((select status = 'bloqueado' and mensagem = 'Anúncio não encontrado nesta organização' from public.operacoes_massa_itens
                   where operacao_id = '93000000-0000-0000-0000-000000000509' and ml_item_id = 'MLBS'), '(o) sem etapa → bloqueado');
select pg_temp.ok(public.reajuste_ativo_produto(:org, '09310078') is null, '(o) reserva solta');

-- reajuste_ativo_produto.
select pg_temp.ok(public.reajuste_ativo_produto(:org, '09310001') is null, 'ativo: nenhum');
update public.operacoes_massa_itens set status = 'conferindo' where operacao_id = :op1 and ml_item_id = 'MLBX';
select pg_temp.ok(public.reajuste_ativo_produto(:org, '09310001') = 'MLBX', 'ativo: conferindo conta');
select pg_temp.ok(public.reajuste_ativo_produto(:org2, '09310001') is null, 'ativo: outra org');

-- Permissões: só service_role executa.
select pg_temp.ok(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                  and has_function_privilege('service_role', p.oid, 'execute') and p.prosecdef
                  and p.proconfig @> array['search_path=""'], 'permissões ' || p.proname)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('reajuste_codigo_pai','reajuste_ativo_produto','reajuste_reivindicar','reajuste_confirmar',
  'reajuste_persistir','reajuste_variacoes_do_mlb','familia_reservar_publicacao','familia_reservar_migracao_pxv',
  'operacoes_massa_reivindicar','reajuste_trava_produto');
select pg_temp.ok((select count(*) = 10 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('reajuste_codigo_pai','reajuste_ativo_produto','reajuste_reivindicar','reajuste_confirmar',
  'reajuste_persistir','reajuste_variacoes_do_mlb','familia_reservar_publicacao','familia_reservar_migracao_pxv',
  'operacoes_massa_reivindicar','reajuste_trava_produto')), 'as 10 funções existem');

select 'reajuste_preco: OK';
rollback;
