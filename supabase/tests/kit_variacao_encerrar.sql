\set ON_ERROR_STOP on
-- ADR-0200, emenda "Encerrar kit": `kit_variacao_encerrar`, `kit_encerrar_finalizar`, regra de participante e redes.
-- Fixtures só dentro da transação desfeita (scripts/teste-sql-desfeito.py), em org própria; nada fora dela é tocado.
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97500000-0000-0000-0000-000000000001', 'Kit encerrar', 'kit-encerrar-teste', array['kit_variacao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97500000-0000-0000-0000-000000000101', 'kit-encerrar@teste.local', '{"org_id":"97500000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97500000-0000-0000-0000-000000000101', '97500000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97500000-0000-0000-0000-000000000201', '97500000-0000-0000-0000-000000000101',
   '97500000-0000-0000-0000-000000000001', 'processando', 'manual');
-- Base (09800000: peças A, B, C), kit 1 (09810000: K1 = A+B com anúncio, K2 = A+B sem UP), kit 2 vivo
-- (09820000: K3 = B+C), kit 3 sem nada no ML (09830000: K4 = B+C).
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, status, ml_item_id)
select f::uuid, '97500000-0000-0000-0000-000000000201', '97500000-0000-0000-0000-000000000101',
       '97500000-0000-0000-0000-000000000001', p, p, 'CREATE', 'nacional', gen_random_uuid(), 'publicado', m
from (values ('97500000-0000-0000-0000-000000000301', '09800000', 'MLB-BASE'),
             ('97500000-0000-0000-0000-000000000302', '09810000', 'MLB-K1'),
             ('97500000-0000-0000-0000-000000000303', '09820000', 'MLB-K3'),
             ('97500000-0000-0000-0000-000000000304', '09830000', null)) x(f, p, m);
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
select f::uuid, '97500000-0000-0000-0000-000000000101', '97500000-0000-0000-0000-000000000001', c, c, c, 'M', 50, 0
from (values ('97500000-0000-0000-0000-000000000301', '09800001'), ('97500000-0000-0000-0000-000000000301', '09800002'),
             ('97500000-0000-0000-0000-000000000301', '09800003'),
             ('97500000-0000-0000-0000-000000000302', '09810001'), ('97500000-0000-0000-0000-000000000302', '09810002'),
             ('97500000-0000-0000-0000-000000000303', '09820001'), ('97500000-0000-0000-0000-000000000304', '09830001')) x(f, c);
insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco, so_em_kit, reposicao_auto, status) values
  ('97500000-0000-0000-0000-000000000401', '97500000-0000-0000-0000-000000000001', '09800000', '09810000', 2, 90, true, true, 'publicado'),
  ('97500000-0000-0000-0000-000000000402', '97500000-0000-0000-0000-000000000001', '09800000', '09820000', 2, 90, true, false, 'publicado'),
  ('97500000-0000-0000-0000-000000000403', '97500000-0000-0000-0000-000000000001', '09800000', '09830000', 2, 90, false, false, 'erro');
insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor) values
  ('97500000-0000-0000-0000-000000000501', '97500000-0000-0000-0000-000000000001', '97500000-0000-0000-0000-000000000401', '09810001', 'M', array['A','B'], 'A + B'),
  ('97500000-0000-0000-0000-000000000502', '97500000-0000-0000-0000-000000000001', '97500000-0000-0000-0000-000000000401', '09810002', 'G', array['A','B'], 'A + B'),
  ('97500000-0000-0000-0000-000000000503', '97500000-0000-0000-0000-000000000001', '97500000-0000-0000-0000-000000000402', '09820001', 'M', array['B','C'], 'B + C'),
  ('97500000-0000-0000-0000-000000000504', '97500000-0000-0000-0000-000000000001', '97500000-0000-0000-0000-000000000403', '09830001', 'M', array['B','C'], 'B + C');
insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade) values
  ('97500000-0000-0000-0000-000000000501', '97500000-0000-0000-0000-000000000001', '09800001', 1),
  ('97500000-0000-0000-0000-000000000501', '97500000-0000-0000-0000-000000000001', '09800002', 1),
  ('97500000-0000-0000-0000-000000000502', '97500000-0000-0000-0000-000000000001', '09800001', 1),
  ('97500000-0000-0000-0000-000000000502', '97500000-0000-0000-0000-000000000001', '09800002', 1),
  ('97500000-0000-0000-0000-000000000503', '97500000-0000-0000-0000-000000000001', '09800002', 1),
  ('97500000-0000-0000-0000-000000000503', '97500000-0000-0000-0000-000000000001', '09800003', 1),
  ('97500000-0000-0000-0000-000000000504', '97500000-0000-0000-0000-000000000001', '09800002', 1),
  ('97500000-0000-0000-0000-000000000504', '97500000-0000-0000-0000-000000000001', '09800003', 1);
-- Vender só em kit: A e B guardados pelo kit 1; B também pelo kit 2. A tem bloqueio do operador? Não: A fica livre.
insert into public.sku_politica_kit (org_id, codigo, estado, versao) values
  ('97500000-0000-0000-0000-000000000001', '09800001', 'guardado', 3),
  ('97500000-0000-0000-0000-000000000001', '09800002', 'guardado', 5);
insert into public.sku_reivindicacoes_kit (org_id, codigo, kit_id) values
  ('97500000-0000-0000-0000-000000000001', '09800001', '97500000-0000-0000-0000-000000000401'),
  ('97500000-0000-0000-0000-000000000001', '09800002', '97500000-0000-0000-0000-000000000401'),
  ('97500000-0000-0000-0000-000000000001', '09800002', '97500000-0000-0000-0000-000000000402');
-- Pausas da automação: o individual de A (desfeita depois pela reposição) e o item do K1 (fechado: sai junto).
insert into public.kit_pausas_automaticas (org_id, codigo, item_id, transferencia_id) values
  ('97500000-0000-0000-0000-000000000001', '09800001', 'MLB-IND-A', gen_random_uuid()),
  ('97500000-0000-0000-0000-000000000001', '09810001', 'MLB-K1', gen_random_uuid());
-- Vínculo do kit 1: só K1 tem item (com cópia de catálogo); K2 nunca chegou ao ML.
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai, particao, status) values
  ('97500000-0000-0000-0000-000000000601', '97500000-0000-0000-0000-000000000101', '97500000-0000-0000-0000-000000000001',
   'mercado_livre', '09810000', 0, 'publicado');
insert into public.anuncios_externos_itens (anuncio_externo_id, org_id, sku, item_externo_id, user_product_id, catalog_listing_id, status) values
  ('97500000-0000-0000-0000-000000000601', '97500000-0000-0000-0000-000000000001', '09810001', 'MLB-K1', 'UP-K1', 'MLB-K1C', 'pausado');

create temp table ctx on commit drop as
select '97500000-0000-0000-0000-000000000001'::uuid as org, '97500000-0000-0000-0000-000000000101'::uuid as usuario,
       '97500000-0000-0000-0000-000000000401'::uuid as kit1, '97500000-0000-0000-0000-000000000402'::uuid as kit2,
       '97500000-0000-0000-0000-000000000403'::uuid as kit3;
grant select on ctx to service_role;

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;
create function pg_temp.estoque(p_org uuid, p_codigo text) returns integer language sql as $$
  select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
  where v.org_id = p_org and v.codigo = p_codigo order by f.criado_em desc, f.id desc limit 1
$$;

-- ACL.
do $$
declare f text;
begin
  foreach f in array array['public.kit_variacao_encerrar(uuid, uuid, integer)', 'public.kit_encerrar_finalizar(uuid, uuid, uuid)',
                           'public.kit_encerrar_aplicar(uuid, uuid)', 'public.kit_participante(uuid, text)',
                           'public.kit_codigos_triagem(uuid)'] loop
    perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), f || ' exposta a anon');
    perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta a authenticated');
    perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), f || ' sem service_role');
  end loop;
end $$;

-- Venda antiga do K1, antes do encerramento: entra 1, vende 1 (o estorno vem depois de encerrado).
set local role service_role;
do $$
declare c record; r jsonb;
begin
  select * into c from ctx;
  perform public.registrar_entrada(c.org, '09810001', 1, null, null, null, c.usuario, 'kit-encerrar:k1');
  r := public.baixar_estoque(c.org, '09810001', 1, 'mercado_livre', 'mercado_livre:9751:09810001');
  perform pg_temp.afirmar((r->>'aplicado')::boolean, 'baixa antiga: ' || r::text);
end $$;
reset role;
create temp table antes on commit drop as
select (select count(*) from public.estoque_movimentos where org_id = c.org) movs,
       (select count(*) from public.variacoes where org_id = c.org) vars,
       (select count(*) from public.kit_variacao_componentes where org_id = c.org) comps
from ctx c;

-- 1. Recusas: saldo, transferência aberta, versão. Nada muda.
set local role service_role;
do $$
declare c record; r jsonb; v integer;
begin
  select * into c from ctx;
  select versao into v from public.kits_variacao where id = c.kit1;
  perform public.registrar_entrada(c.org, '09810002', 2, null, null, null, c.usuario, 'kit-encerrar:k2');
  r := public.kit_variacao_encerrar(c.org, c.kit1, v);
  perform pg_temp.afirmar(r->>'motivo' = 'saldo' and r->>'codigo' = '09810002', 'saldo > 0 recusa: ' || r::text);
  perform public.ajustar_estoque(c.org, '09810002', 0, 'teste', c.usuario, 'kit-encerrar:ajuste');
  perform pg_temp.afirmar(pg_temp.estoque(c.org, '09810002') = 0, 'ajuste zerou K2');

  insert into public.kit_transferencias (id, org_id, kit_id, tipo, versao_politica, itens, estado)
  values ('97500000-0000-0000-0000-000000000701', c.org, c.kit1, 'desmontar', 0, '[]', 'travada');
  r := public.kit_variacao_encerrar(c.org, c.kit1, v);
  perform pg_temp.afirmar(r->>'motivo' = 'transferencia_aberta', 'travada recusa: ' || r::text);
  update public.kit_transferencias set estado = 'concluida' where id = '97500000-0000-0000-0000-000000000701';

  r := public.kit_variacao_encerrar(c.org, c.kit1, v - 1);
  perform pg_temp.afirmar(r->>'motivo' = 'versao', 'versão velha recusa: ' || r::text);
  perform pg_temp.afirmar((select status from public.kits_variacao where id = c.kit1) = 'publicado', 'recusa não muda o kit');
end $$;
reset role;

-- 2. Encerrar: intenção, versão, alvos do vínculo local (item + catálogo), exclusão de todos os SKUs do kit.
set local role service_role;
do $$
declare c record; r jsonb; r2 jsonb; v integer; t uuid;
begin
  select * into c from ctx;
  select versao into v from public.kits_variacao where id = c.kit1;
  r := public.kit_variacao_encerrar(c.org, c.kit1, v);
  perform pg_temp.afirmar((r->>'ok')::boolean and r->>'transferencia_id' is not null, 'encerrar: ' || r::text);
  t := (r->>'transferencia_id')::uuid;
  perform pg_temp.afirmar((select status = 'encerrando' and versao = v + 1 and not reposicao_auto
                           from public.kits_variacao where id = c.kit1), 'kit em encerrando, versão + 1, reposição off');
  perform pg_temp.afirmar((select tipo = 'encerrar' and passo = 'fechar' and estado = 'ativa'
                           from public.kit_transferencias where id = t), 'transferência encerrar');
  perform pg_temp.afirmar((select count(*) = 1 and bool_and(up_id = 'UP-K1' and codigo = '09810001'
                                                             and item_ids = array['MLB-K1', 'MLB-K1C'])
                           from public.kit_transferencia_alvos where transferencia_id = t), 'alvo com item e cópia de catálogo');
  perform pg_temp.afirmar((select array_agg(codigo order by codigo) from public.kit_exclusoes where dono_id = t)
                          = array['09810001', '09810002'], 'exclusão dos dois SKUs (K2 sem UP também)');
  -- A transferência segura só os SKUs do kit: entrada de peça segue.
  perform pg_temp.afirmar(not public.kit_reposicao_pendente(c.org, '09800001'), 'peça não fica presa no encerrar');
  -- Repetição: mesma transferência, sem efeito.
  r2 := public.kit_variacao_encerrar(c.org, c.kit1, v);
  perform pg_temp.afirmar((r2->>'existente')::boolean and (r2->>'transferencia_id')::uuid = t, 'repetição: ' || r2::text);
end $$;
reset role;
do $$
declare c record;
begin
  select * into c from ctx;
  -- Entrada de peça durante o encerramento (dono executor, como no app).
  perform public.registrar_entrada(c.org, '09800001', 1, null, null, null, c.usuario, 'kit-encerrar:a');
end $$;

-- 3. Redes: kit encerrando não recebe montar, entrada pelo SKU (kit_id nulo), publicação nem política.
do $$
declare c record; ok boolean;
begin
  select * into c from ctx;
  begin
    perform public.kit_criar_transferencia(c.org, c.kit1, 'montar', '[{"codigo":"09810001","quantidade":1}]',
      '[{"codigo":"09810001","up_id":"UP-K1","item_ids":["MLB-K1"]}]');
    ok := false;
  exception when sqlstate 'KX030' then ok := true;
  end;
  perform pg_temp.afirmar(ok, 'montar em kit encerrando recusado');
  begin
    perform public.kit_criar_transferencia(c.org, null, 'entrada', '[{"codigo":"09810001","quantidade":0}]',
      '[{"codigo":"09810001","up_id":"UP-K1","item_ids":["MLB-K1"]}]');
    ok := false;
  exception when sqlstate 'KX030' then ok := true;
  end;
  perform pg_temp.afirmar(ok, 'entrada com kit_id nulo em SKU de kit encerrando recusada');
  begin
    insert into public.kit_exclusoes (org_id, codigo, dono_tipo, dono_id) values (c.org, '09830001', 'publicacao', gen_random_uuid());
    delete from public.kit_exclusoes where org_id = c.org and codigo = '09830001';   -- kit 3 ainda vivo: aceita
    update public.kits_variacao set reposicao_auto = true where id = c.kit1;
    ok := false;
  exception when sqlstate 'KX030' then ok := true;
  end;
  perform pg_temp.afirmar(ok, 'religar reposição em kit encerrando recusado');
end $$;

-- 4. Finalizar exige todos os alvos confirmados; depois aplica tudo numa transação.
set local role service_role;
do $$
declare c record; t uuid; tok uuid := gen_random_uuid(); r jsonb; ok boolean;
begin
  select * into c from ctx;
  select id into t from public.kit_transferencias where kit_id = c.kit1 and tipo = 'encerrar';
  perform pg_temp.afirmar(public.kit_reivindicar_execucao(c.org, t, tok, 60), 'claim');
  begin
    perform public.kit_encerrar_finalizar(c.org, t, tok);
    ok := false;
  exception when sqlstate 'KX041' then ok := true;
  end;
  perform pg_temp.afirmar(ok, 'finalizar com item sem fechamento confirmado recusa');
  perform public.kit_saga_salvar_alvo(c.org, t, tok, 'UP-K1', jsonb_build_object('escrita_em', now()));
  perform pg_temp.afirmar((select marca_ordem is null and confirmada_em is null from public.kit_transferencia_alvos
                           where transferencia_id = t), 'fechamento não mexe na marca d''água');
  r := public.kit_encerrar_finalizar(c.org, t, tok);
  perform pg_temp.afirmar(r->>'codigo_pai_kit' = '09810000' and r->'normais' = '["09800001"]'::jsonb, 'finalizar: ' || r::text);
end $$;
reset role;
do $$
declare c record; a record;
begin
  select * into c from ctx;
  perform pg_temp.afirmar((select status = 'encerrado' and encerrado_em is not null and not so_em_kit and not reposicao_auto
                           from public.kits_variacao where id = c.kit1), 'kit encerrado');
  perform pg_temp.afirmar((select estado = 'concluida' and passo = 'fim' from public.kit_transferencias
                           where kit_id = c.kit1 and tipo = 'encerrar'), 'transferência concluída');
  perform pg_temp.afirmar(not exists (select 1 from public.kit_exclusoes where org_id = c.org), 'exclusões soltas');
  perform pg_temp.afirmar(not exists (select 1 from public.sku_reivindicacoes_kit where kit_id = c.kit1), 'reivindicações do kit saem');
  -- A sem outra reivindicação volta a Normal (versão + 1); B segue Guardado pelo kit 2.
  perform pg_temp.afirmar((select estado = 'normal' and versao = 4 from public.sku_politica_kit where org_id = c.org and codigo = '09800001'),
                          'A volta a Normal com versão + 1');
  perform pg_temp.afirmar((select estado = 'guardado' and versao = 5 from public.sku_politica_kit where org_id = c.org and codigo = '09800002'),
                          'B segue Guardado (outro kit o reivindica)');
  perform pg_temp.afirmar(not exists (select 1 from public.kit_pausas_automaticas where item_id = 'MLB-K1'), 'pausa do item fechado sai');
  perform pg_temp.afirmar(exists (select 1 from public.kit_pausas_automaticas where item_id = 'MLB-IND-A'),
                          'pausa do individual fica para a reposição desfazer');
  perform pg_temp.afirmar((select retirado and status = 'pausado' from public.anuncios_externos_itens where sku = '09810001' and org_id = c.org),
                          'filho do kit retirado');
  perform pg_temp.afirmar(exists (select 1 from public.anuncios_externos where org_id = c.org and codigo_pai = '09810000'),
                          'raiz do kit preservada');
  -- Ledger, variações e composição intactos (o teste só acrescentou as entradas e o ajuste).
  select * into a from antes;
  perform pg_temp.afirmar((select count(*) from public.variacoes where org_id = c.org) = a.vars, 'variações preservadas');
  perform pg_temp.afirmar((select count(*) from public.kit_variacao_componentes where org_id = c.org) = a.comps, 'composição preservada');
  perform pg_temp.afirmar((select count(*) from public.estoque_movimentos where org_id = c.org) >= a.movs, 'ledger preservado');
  perform pg_temp.afirmar(exists (select 1 from public.estoque_movimentos
                                  where org_id = c.org and referencia_externa = 'mercado_livre:9751:09810001'), 'venda antiga no ledger');
end $$;

-- 5. Participante depois do encerramento.
set local role service_role;
do $$
declare c record;
begin
  select * into c from ctx;
  -- K1 (SKU de kit) sempre; B (kit 2 vivo); A ainda tem pausa da automação a desfazer.
  perform pg_temp.afirmar(public.kit_skus_participantes(c.org, array['09810001', '09800001', '09800002', '09800003'])
                          = array['09800001', '09800002', '09800003', '09810001'], 'participantes com pausa pendente');
  delete from public.kit_pausas_automaticas where org_id = c.org and item_id = 'MLB-IND-A';   -- a reposição desfez
  perform pg_temp.afirmar(not public.kit_participante(c.org, '09800001'), 'A sem kit vivo, sem política nem pausa: SKU comum');
  update public.sku_politica_kit set bloqueio_operador = true where org_id = c.org and codigo = '09800001';
  perform pg_temp.afirmar(public.kit_participante(c.org, '09800001'), 'pausa do operador mantém a peça na regra do kit');
  update public.sku_politica_kit set bloqueio_operador = false where org_id = c.org and codigo = '09800001';
  -- Triagem: SKU de kit encerrado fica de fora; o do kit vivo e as peças presas entram.
  perform pg_temp.afirmar(public.kit_codigos_triagem(c.org) = array['09800002', '09800003', '09820001', '09830001'],
                          'triagem: ' || public.kit_codigos_triagem(c.org)::text);
end $$;
reset role;

-- 6. Kit encerrado não recebe publicação, cancelamento (entrada pelo SKU) nem volta de status.
do $$
declare c record; ok boolean;
begin
  select * into c from ctx;
  begin
    insert into public.kit_exclusoes (org_id, codigo, dono_tipo, dono_id) values (c.org, '09810001', 'republicacao', gen_random_uuid());
    ok := false;
  exception when sqlstate 'KX030' then ok := true;
  end;
  perform pg_temp.afirmar(ok, 'republicação de kit encerrado recusada');
  begin
    perform public.kit_criar_transferencia(c.org, c.kit1, 'cancelamento', '[{"codigo":"09810001","quantidade":0}]',
      '[{"codigo":"09810001","up_id":"UP-K1","item_ids":["MLB-K1"]}]');
    ok := false;
  exception when sqlstate 'KX030' then ok := true;
  end;
  perform pg_temp.afirmar(ok, 'cancelamento em kit encerrado não vira transferência');
  begin
    update public.kits_variacao set status = 'publicado' where id = c.kit1;
    ok := false;
  exception when sqlstate 'KX030' then ok := true;
  end;
  perform pg_temp.afirmar(ok, 'kit encerrado não volta');
  -- Excluir a última cópia do SKU do kit segue recusado (venda tardia precisa da variação).
  begin
    delete from public.variacoes where org_id = c.org and codigo = '09810001';
    ok := false;
  exception when sqlstate '23514' then ok := true;
  end;
  perform pg_temp.afirmar(ok, 'variação do SKU de kit encerrado não sai');
end $$;

-- 7. Estorno tardio do pedido antigo: credita pelo caminho normal (o aviso é da edge, avisarKitsEncerrados).
set local role service_role;
do $$
declare c record; r jsonb;
begin
  select * into c from ctx;
  r := public.estornar_estoque(c.org, 'mercado_livre', 'mercado_livre:9751:09810001', '09810001');
  perform pg_temp.afirmar(pg_temp.estoque(c.org, '09810001') = 1, 'estorno tardio credita o SKU do kit: ' || coalesce(r::text, 'null'));
  -- Venda tardia (pedido antigo importado depois): baixa pelo caminho normal, com a identidade estável do SKU.
  r := public.baixar_estoque(c.org, '09810001', 1, 'mercado_livre', 'mercado_livre:9752:09810001');
  perform pg_temp.afirmar((r->>'aplicado')::boolean and pg_temp.estoque(c.org, '09810001') = 0, 'venda tardia baixa: ' || r::text);
  -- 8. Kit sem nada no ML encerra direto, sem transferência. Publicação em curso (exclusão) recusa antes.
  perform public.kit_adquirir_exclusao(c.org, array['09830001'], 'publicacao', '97500000-0000-0000-0000-000000000801');
  r := public.kit_variacao_encerrar(c.org, c.kit3, (select versao from public.kits_variacao where id = c.kit3));
  perform pg_temp.afirmar(r->>'motivo' = 'up_ocupado' and r->>'codigo' = '09830001', 'publicação em curso recusa: ' || r::text);
  perform pg_temp.afirmar((select status from public.kits_variacao where id = c.kit3) = 'erro', 'recusa desfaz tudo');
  perform public.kit_soltar_exclusao(c.org, '97500000-0000-0000-0000-000000000801');
  r := public.kit_variacao_encerrar(c.org, c.kit3, (select versao from public.kits_variacao where id = c.kit3));
  perform pg_temp.afirmar((r->>'encerrado')::boolean and r->>'transferencia_id' is null, 'kit sem alvo: ' || r::text);
  perform pg_temp.afirmar((select status from public.kits_variacao where id = c.kit3) = 'encerrado', 'kit 3 encerrado');
  perform pg_temp.afirmar(not exists (select 1 from public.kit_transferencias where kit_id = c.kit3), 'sem transferência');
  perform pg_temp.afirmar(not exists (select 1 from public.kit_exclusoes where org_id = c.org), 'exclusão da transação solta');
end $$;
reset role;

-- Kit publicado sem vínculo local (republicação no meio): recusa, os itens antigos não seriam fechados.
set local role service_role;
do $$
declare c record; r jsonb;
begin
  select * into c from ctx;
  r := public.kit_variacao_encerrar(c.org, c.kit2, (select versao from public.kits_variacao where id = c.kit2));
  perform pg_temp.afirmar(r->>'motivo' = 'sem_vinculo', 'publicado sem vínculo recusa: ' || r::text);
  perform pg_temp.afirmar((select status from public.kits_variacao where id = c.kit2) = 'publicado', 'kit 2 intacto');
  -- Republicação não trava o kit (evita o ciclo com adicionar), mas segue recusada em kit encerrado.
end $$;
reset role;

-- Módulo desligado: nada.
update public.organizations set modulos_habilitados = '{}' where id = (select org from ctx);
do $$
declare c record; r jsonb;
begin
  select * into c from ctx;
  r := public.kit_variacao_encerrar(c.org, c.kit2, 1);
  perform pg_temp.afirmar(r->>'motivo' = 'modulo_desligado', 'módulo desligado: ' || r::text);
end $$;

rollback;
