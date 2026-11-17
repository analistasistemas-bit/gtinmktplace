\set ON_ERROR_STOP on
-- ADR-0207 (migration reposicao): modelo de dados, RLS e recebimento atômico do pedido de compra.
-- Rodar com scripts/teste-sql-desfeito.py <este arquivo> <migration>. Transação sempre desfeita; fixtures numa
-- org própria.
--
-- Concorrência real de duas sessões não cabe em transação única: o recebimento é um único
-- `update … set recebida = least(quantidade, recebida + n)` sob o lock do pedido (prova pela leitura do corpo),
-- e aqui dois recebimentos de 8 num item de 10 rodam em sequência e terminam em 10 sem violar o CHECK.
begin;

create function pg_temp.afirmar(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHA: %', p_msg; end if;
end $$;
grant execute on function pg_temp.afirmar(boolean, text) to service_role;

-- Estrutura, RLS e privilégios: antes de qualquer chamada.
do $$
declare t text; f text; v record;
begin
  foreach t in array array['reposicao_config','fornecedores','reposicao_nao_repor','pedidos_compra',
                           'pedidos_compra_itens','pedidos_compra_recebimentos','reposicao_fotos'] loop
    perform pg_temp.afirmar((select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ' sem RLS');
    perform pg_temp.afirmar(has_table_privilege('authenticated', 'public.' || t, 'SELECT'), t || ': authenticated sem SELECT');
    perform pg_temp.afirmar(not has_table_privilege('authenticated', 'public.' || t, 'INSERT')
      and not has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
      and not has_table_privilege('authenticated', 'public.' || t, 'DELETE')
      and not has_table_privilege('anon', 'public.' || t, 'SELECT'), t || ': escrita/anon indevidos');
    perform pg_temp.afirmar(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
      and cmd <> 'SELECT'), t || ': policy de escrita');
  end loop;

  -- authenticated sem execute nas RPCs.
  foreach f in array array[
    'public.reposicao_receber(uuid, uuid, text, integer, text)',
    'public.reposicao_desfazer_recebimentos(uuid, text[])',
    'public.reposicao_validar_pedido(uuid, uuid, text)',
    'public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text, uuid)',
    'public.importar_nota_compra(uuid, uuid, jsonb, jsonb, uuid, boolean)',
    'public.desfazer_nota_compra(uuid, uuid, uuid, text)'
  ] loop
    perform pg_temp.afirmar(not has_function_privilege('authenticated', f, 'execute'), f || ' exposta a authenticated');
    perform pg_temp.afirmar(not has_function_privilege('anon', f, 'execute'), f || ' exposta a anon');
    perform pg_temp.afirmar(has_function_privilege('service_role', f, 'execute'), f || ' sem service_role');
  end loop;
  foreach f in array array['public.reposicao_receber(uuid, uuid, text, integer, text)',
                           'public.reposicao_desfazer_recebimentos(uuid, text[])'] loop
    select p.prosecdef, p.proconfig into v from pg_proc p where p.oid = f::regprocedure;
    perform pg_temp.afirmar(v.prosecdef and v.proconfig = array['search_path=""'], f || ' sem definer/search_path');
  end loop;

  -- Sem sobrecarga: a assinatura antiga sumiu.
  perform pg_temp.afirmar((select count(*) from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('registrar_entrada','importar_nota_compra')) = 2, 'sobrecarga nas RPCs de entrada');
  -- Dono e ACL das RPCs de estoque: idênticos aos de hoje.
  select p.proowner::regrole::text as dono, p.prosecdef, p.proacl::text as acl into v
    from pg_proc p where p.oid = 'public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text, uuid)'::regprocedure;
  perform pg_temp.afirmar(v.dono = 'estoque_rpc_executor' and v.prosecdef
    and v.acl = '{estoque_rpc_executor=X/estoque_rpc_executor,service_role=X/estoque_rpc_executor}',
    'registrar_entrada: dono/ACL mudaram: ' || v.dono || ' ' || v.acl);
  foreach f in array array['public.importar_nota_compra(uuid, uuid, jsonb, jsonb, uuid, boolean)',
                           'public.desfazer_nota_compra(uuid, uuid, uuid, text)'] loop
    select p.proowner::regrole::text as dono, p.prosecdef, p.proacl::text as acl into v from pg_proc p where p.oid = f::regprocedure;
    perform pg_temp.afirmar(v.dono = 'postgres' and not v.prosecdef and v.acl = '{postgres=X/postgres,service_role=X/postgres}',
      f || ': dono/ACL mudaram: ' || v.dono || ' ' || v.acl);
  end loop;

  -- Ordem de locks (prova pela leitura do corpo): pedido antes de qualquer variação.
  perform pg_temp.afirmar((select position('reposicao_validar_pedido' in prosrc) between 1 and position('for update' in prosrc)
    from pg_proc where oid = 'public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text, uuid)'::regprocedure),
    'registrar_entrada: pedido não é o primeiro lock');
  -- A baixa só é escrita depois do INSERT do movimento (ref duplicada não deixa recebimento órfão).
  perform pg_temp.afirmar((select position('perform public.reposicao_receber' in prosrc) > position('insert into public.estoque_movimentos' in prosrc)
      and position('insert into public.estoque_movimentos' in prosrc) > 0
    from pg_proc where oid = 'public.registrar_entrada(uuid, text, integer, numeric, text, text, uuid, text, uuid)'::regprocedure),
    'registrar_entrada: recebimento gravado antes do movimento');
  perform pg_temp.afirmar((select position('from public.pedidos_compra p where p.id = p_pedido_compra' in prosrc)
      between 1 and position('public.registrar_entrada(' in prosrc)
    from pg_proc where oid = 'public.importar_nota_compra(uuid, uuid, jsonb, jsonb, uuid, boolean)'::regprocedure),
    'importar_nota_compra: pedido não é travado antes do lançamento');
  perform pg_temp.afirmar((select position('from public.pedidos_compra p' in prosrc) between 1 and position('for update of v' in prosrc)
    from pg_proc where oid = 'public.desfazer_nota_compra(uuid, uuid, uuid, text)'::regprocedure),
    'desfazer_nota_compra: pedidos não são travados antes das variações');

  perform pg_temp.afirmar((select column_default = '1' and is_nullable = 'NO' from information_schema.columns
    where table_schema = 'public' and table_name = 'familias' and column_name = 'multiplo_compra'), 'familias.multiplo_compra');
  perform pg_temp.afirmar(pg_get_constraintdef((select oid from pg_constraint where conname = 'notificacoes_categoria_check'))
    like '%''reposicao''%' and pg_get_constraintdef((select oid from pg_constraint where conname = 'notificacoes_categoria_check'))
    like '%''imagem_ia''%', 'notificacoes_categoria_check');
  perform pg_temp.afirmar(pg_get_constraintdef((select oid from pg_constraint where conname = 'profiles_telegram_categorias_validas'))
    like '%''reposicao''%' and pg_get_constraintdef((select oid from pg_constraint where conname = 'profiles_telegram_categorias_validas'))
    like '%''fechamento_mensal''%', 'profiles_telegram_categorias_validas');
  perform pg_temp.afirmar(not exists (select 1 from public.profiles where 'estoque' = any(allowed_menus)
    and not ('reposicao' = any(allowed_menus))), 'allowed_menus sem reposicao');
end $$;

-- Fixtures (como postgres).
insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('98000000-0000-0000-0000-000000000001', 'Reposição teste', 'reposicao-teste', array['estoque','reposicao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('98000000-0000-0000-0000-000000000101', 'reposicao@teste.local', '{"org_id":"98000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('98000000-0000-0000-0000-000000000101', '98000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('98000000-0000-0000-0000-000000000201', '98000000-0000-0000-0000-000000000101',
   '98000000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro) values
  ('98000000-0000-0000-0000-000000000301', '98000000-0000-0000-0000-000000000201',
   '98000000-0000-0000-0000-000000000101', '98000000-0000-0000-0000-000000000001',
   '09800000', 'Calça teste', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
select '98000000-0000-0000-0000-000000000301', '98000000-0000-0000-0000-000000000101',
       '98000000-0000-0000-0000-000000000001', c, c, 'Preto', c, 50, 0
from unnest(array['09800001','09800002','09800003','09800004','09800005','09800006','09800007','09800008','09800009']) c;

insert into public.fornecedores (id, org_id, nome, nome_normalizado, cnpj) values
  ('98000000-0000-0000-0000-000000000401', '98000000-0000-0000-0000-000000000001', 'Fornecedor Teste', 'fornecedor teste', null),
  ('98000000-0000-0000-0000-000000000402', '98000000-0000-0000-0000-000000000001', 'Fornecedor A', 'fornecedor a', '99888777000166'),
  ('98000000-0000-0000-0000-000000000403', '98000000-0000-0000-0000-000000000001', 'Fornecedor B', 'fornecedor b', null);

-- Pedidos: 0501 parcial · 0502 excedente · 0503 mesma ref · 0504 concorrência · 0505 rascunho · 0506 outro fornecedor
-- · 0507 nota + desfazer · 0508 nota com excedente em duas linhas.
insert into public.pedidos_compra (id, org_id, fornecedor_id, status, enviado_em) values
  ('98000000-0000-0000-0000-000000000501', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000401', 'enviado', now()),
  ('98000000-0000-0000-0000-000000000502', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000401', 'enviado', now()),
  ('98000000-0000-0000-0000-000000000503', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000401', 'aprovado', null),
  ('98000000-0000-0000-0000-000000000504', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000401', 'aprovado', null),
  ('98000000-0000-0000-0000-000000000505', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000401', 'rascunho', null),
  ('98000000-0000-0000-0000-000000000506', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000402', 'aprovado', null),
  ('98000000-0000-0000-0000-000000000507', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000403', 'aprovado', null),
  ('98000000-0000-0000-0000-000000000508', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000401', 'enviado', now()),
  ('98000000-0000-0000-0000-000000000509', '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000401', 'saldo_encerrado', now());
insert into public.pedidos_compra_itens (pedido_id, org_id, codigo, codigo_pai, quantidade, sugerida)
select p, '98000000-0000-0000-0000-000000000001', c, '09800000', 10, 10
from (values ('98000000-0000-0000-0000-000000000501'::uuid, '09800001'),
             ('98000000-0000-0000-0000-000000000502'::uuid, '09800002'),
             ('98000000-0000-0000-0000-000000000503'::uuid, '09800003'),
             ('98000000-0000-0000-0000-000000000504'::uuid, '09800004'),
             ('98000000-0000-0000-0000-000000000505'::uuid, '09800005'),
             ('98000000-0000-0000-0000-000000000506'::uuid, '09800006'),
             ('98000000-0000-0000-0000-000000000507'::uuid, '09800007'),
             ('98000000-0000-0000-0000-000000000508'::uuid, '09800009'),
             ('98000000-0000-0000-0000-000000000509'::uuid, '09800001')) x(p, c);

-- Segundo rascunho do mesmo fornecedor viola o índice único.
do $$
begin
  begin
    insert into public.pedidos_compra (org_id, fornecedor_id, status) values
      ('98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000401', 'rascunho');
    raise exception 'FALHA: segundo rascunho do mesmo fornecedor aceito';
  exception when unique_violation then null;
  end;
  begin
    insert into public.reposicao_nao_repor (org_id, escopo, codigo_pai) values
      ('98000000-0000-0000-0000-000000000001', 'familia', '09800000'),
      ('98000000-0000-0000-0000-000000000001', 'familia', '09800000');
    raise exception 'FALHA: Não repor duplicado aceito';
  exception when unique_violation then null;
  end;
end $$;
-- Task 7: SKU do pedido 0503 marcado Não repor DEPOIS do pedido continua recebível (o bloco "mesma ref" abaixo recebe nele).
insert into public.reposicao_nao_repor (org_id, escopo, codigo_pai, codigo) values
  ('98000000-0000-0000-0000-000000000001', 'sku', '09800000', '09800003');

set local role service_role;
do $$
declare
  O constant uuid := '98000000-0000-0000-0000-000000000001';
  U constant uuid := '98000000-0000-0000-0000-000000000101';
  r jsonb; v_rec int; v_st text; v_est int; v_nota uuid; v_movs bigint;
  nota_a jsonb := jsonb_build_object('chave', '26261011222333000181550010000020521000030324', 'numero', 2052, 'serie', 1,
    'emitente_cnpj', '11222333000181', 'emitente_nome', 'Fornecedor B', 'emitida_em', '2026-11-13T15:57:33-03:00',
    'valor_total', 30, 'assinada', false, 'xml_path', 'reposicao/a.xml', 'xml_sha256', 'abc');
  nota_b jsonb := jsonb_build_object('chave', '26261011222333000181550010000020531000030324', 'numero', 2053, 'serie', 1,
    'emitente_cnpj', '11222333000181', 'emitente_nome', 'Fornecedor B', 'emitida_em', '2026-11-13T15:57:33-03:00',
    'valor_total', 30, 'assinada', false, 'xml_path', 'reposicao/b.xml', 'xml_sha256', 'abc');
  itens_a jsonb := '[{"n_item":1,"cprod":"REF A","xprod":"Calça","ncm":"62034200","cfop":"5102","gtin":null,
    "ucom":"PC","qcom":3,"fator_conversao":1,"v_prod":30,"v_frete":0,"v_seg":0,"v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,
    "rateio":{},"orig":0,"codigo_pai":"09800000",
    "distribuicao":[{"codigo":"09800006","quantidade":3,"custo_aquisicao_unit":10,"custo_precificacao_unit":12}]}]';
  -- 09800008 não está no pedido: entra no estoque e não baixa nada.
  itens_b jsonb := '[{"n_item":1,"cprod":"REF B","xprod":"Calça","ncm":"62034200","cfop":"5102","gtin":null,
    "ucom":"PC","qcom":3,"fator_conversao":1,"v_prod":30,"v_frete":0,"v_seg":0,"v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,
    "rateio":{},"orig":0,"codigo_pai":"09800000",
    "distribuicao":[{"codigo":"09800007","quantidade":2,"custo_aquisicao_unit":10,"custo_precificacao_unit":12},
                    {"codigo":"09800008","quantidade":1,"custo_aquisicao_unit":10,"custo_precificacao_unit":12}]}]';
  -- Excedente em duas linhas do mesmo SKU (ex.: bonificação): a 1ª fecha o pedido, a 2ª não pode abortar a nota.
  nota_c jsonb := jsonb_build_object('chave', '26261011222333000181550010000020541000030324', 'numero', 2054, 'serie', 1,
    'emitente_cnpj', '11222333000181', 'emitente_nome', 'Fornecedor Teste', 'emitida_em', '2026-11-13T15:57:33-03:00',
    'valor_total', 120, 'assinada', false, 'xml_path', 'reposicao/c.xml', 'xml_sha256', 'abc');
  itens_c jsonb := '[{"n_item":1,"cprod":"REF C1","xprod":"Calça","ncm":"62034200","cfop":"5102","gtin":null,
    "ucom":"PC","qcom":10,"fator_conversao":1,"v_prod":100,"v_frete":0,"v_seg":0,"v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,
    "rateio":{},"orig":0,"codigo_pai":"09800000",
    "distribuicao":[{"codigo":"09800009","quantidade":10,"custo_aquisicao_unit":10,"custo_precificacao_unit":12}]},
    {"n_item":2,"cprod":"REF C2","xprod":"Calça bonificação","ncm":"62034200","cfop":"5910","gtin":null,
    "ucom":"PC","qcom":2,"fator_conversao":1,"v_prod":20,"v_frete":0,"v_seg":0,"v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,
    "rateio":{},"orig":0,"codigo_pai":"09800000",
    "distribuicao":[{"codigo":"09800009","quantidade":2,"custo_aquisicao_unit":10,"custo_precificacao_unit":12}]}]';
  -- Só SKU fora do pedido (09800008).
  nota_d jsonb := jsonb_build_object('chave', '26261011222333000181550010000020551000030324', 'numero', 2055, 'serie', 1,
    'emitente_cnpj', '11222333000181', 'emitente_nome', 'Fornecedor Teste', 'emitida_em', '2026-11-13T15:57:33-03:00',
    'valor_total', 10, 'assinada', false, 'xml_path', 'reposicao/d.xml', 'xml_sha256', 'abc');
  itens_d jsonb := '[{"n_item":1,"cprod":"REF D","xprod":"Calça","ncm":"62034200","cfop":"5102","gtin":null,
    "ucom":"PC","qcom":1,"fator_conversao":1,"v_prod":10,"v_frete":0,"v_seg":0,"v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,
    "rateio":{},"orig":0,"codigo_pai":"09800000",
    "distribuicao":[{"codigo":"09800008","quantidade":1,"custo_aquisicao_unit":10,"custo_precificacao_unit":12}]}]';
begin
  -- Validação prévia da nota: nada é gravado.
  -- (a) nenhum SKU da nota está no pedido → pedido errado.
  begin
    perform public.importar_nota_compra(O, U, nota_d, itens_d, '98000000-0000-0000-0000-000000000503');
    raise exception 'FALHA: nota sem SKU do pedido aceita';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    perform pg_temp.afirmar(sqlerrm like '%nenhum produto da nota%', 'sem SKU do pedido: mensagem ' || sqlerrm);
  end;
  -- (b) pedido em saldo_encerrado → recusa pelo status, mesmo sem SKU do pedido na nota.
  begin
    perform public.importar_nota_compra(O, U, nota_d, itens_d, '98000000-0000-0000-0000-000000000509');
    raise exception 'FALHA: nota em pedido saldo_encerrado aceita';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    perform pg_temp.afirmar(sqlerrm like '%saldo_encerrado%', 'saldo_encerrado: mensagem ' || sqlerrm);
  end;
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800008') = 0, 'validação prévia: estoque');
  perform pg_temp.afirmar(not exists (select 1 from public.notas_compra where org_id = O and chave = nota_d->>'chave'),
    'validação prévia: nota gravada');
  perform pg_temp.afirmar(not exists (select 1 from public.estoque_movimentos where org_id = O
    and referencia_externa like 'nfe:' || (nota_d->>'chave') || ':%'), 'validação prévia: movimento gravado');
  -- (c) entrada manual em pedido saldo_encerrado também recusa antes de lançar.
  begin
    perform public.registrar_entrada(O, '09800001', 1, null, null, null, U, 'rep-encerrado', '98000000-0000-0000-0000-000000000509');
    raise exception 'FALHA: entrada manual em saldo_encerrado aceita';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
  end;
  perform pg_temp.afirmar(not exists (select 1 from public.estoque_movimentos where org_id = O and referencia_externa = 'rep-encerrado'),
    'saldo_encerrado manual: movimento gravado');

  -- parcial: 4 de 10.
  perform public.registrar_entrada(O, '09800001', 4, null, 'NF 1', null, U, 'rep-parcial', '98000000-0000-0000-0000-000000000501');
  select i.recebida, p.status into v_rec, v_st from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
   where i.pedido_id = '98000000-0000-0000-0000-000000000501';
  perform pg_temp.afirmar(v_rec = 4 and v_st = 'parcial', 'parcial: ' || v_rec || ' ' || v_st);
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800001') = 4, 'parcial: estoque');

  -- desfazer (enviado_em preenchido) → recebida 0, status enviado.
  perform pg_temp.afirmar(public.reposicao_desfazer_recebimentos(O, array['rep-parcial']) = 1, 'desfazer: contagem');
  perform pg_temp.afirmar(public.reposicao_desfazer_recebimentos(O, array['rep-parcial']) = 0, 'desfazer: segunda vez não subtrai');
  select i.recebida, p.status into v_rec, v_st from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
   where i.pedido_id = '98000000-0000-0000-0000-000000000501';
  perform pg_temp.afirmar(v_rec = 0 and v_st = 'enviado', 'desfazer enviado: ' || v_rec || ' ' || v_st);

  -- excedente: 12 num item de 10 → recebida 10, recebido, estoque +12.
  perform public.registrar_entrada(O, '09800002', 12, null, 'NF 2', null, U, 'rep-excedente', '98000000-0000-0000-0000-000000000502');
  select i.recebida, p.status into v_rec, v_st from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
   where i.pedido_id = '98000000-0000-0000-0000-000000000502';
  perform pg_temp.afirmar(v_rec = 10 and v_st = 'recebido', 'excedente: ' || v_rec || ' ' || v_st);
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800002') = 12, 'excedente: estoque');

  -- mesma ref 2x: soma uma vez (pela entrada e direto na função).
  perform public.registrar_entrada(O, '09800003', 3, null, null, null, U, 'rep-dup', '98000000-0000-0000-0000-000000000503');
  perform pg_temp.afirmar(public.registrar_entrada(O, '09800003', 3, null, null, null, U, 'rep-dup', '98000000-0000-0000-0000-000000000503') is null,
    'mesma ref: entrada duplicada');
  r := public.reposicao_receber(O, '98000000-0000-0000-0000-000000000503', '09800003', 3, 'rep-dup');
  perform pg_temp.afirmar((r->>'recebida')::int = 3 and (r->>'saldo')::int = 7 and r->>'status_pedido' = 'parcial', 'mesma ref: ' || r::text);
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800003') = 3, 'mesma ref: estoque');

  -- concorrencia: dois recebimentos de 8 (refs diferentes) num item de 10 → 10, sem violar o CHECK.
  perform public.reposicao_receber(O, '98000000-0000-0000-0000-000000000504', '09800004', 8, 'rep-conc-1');
  r := public.reposicao_receber(O, '98000000-0000-0000-0000-000000000504', '09800004', 8, 'rep-conc-2');
  perform pg_temp.afirmar((r->>'recebida')::int = 10 and (r->>'saldo')::int = 0 and r->>'status_pedido' = 'recebido', 'concorrencia: ' || r::text);
  -- desfazer um dos dois: o outro (8) continua valendo → 8, parcial.
  perform public.reposicao_desfazer_recebimentos(O, array['rep-conc-2']);
  select i.recebida, p.status into v_rec, v_st from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
   where i.pedido_id = '98000000-0000-0000-0000-000000000504';
  perform pg_temp.afirmar(v_rec = 8 and v_st = 'parcial', 'desfazer parcial: ' || v_rec || ' ' || v_st);

  -- falha desfaz entrada: pedido em rascunho → erro, estoque e ledger intactos.
  begin
    perform public.registrar_entrada(O, '09800005', 5, null, null, null, U, 'rep-rascunho', '98000000-0000-0000-0000-000000000505');
    raise exception 'FALHA: entrada em pedido rascunho aceita';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
  end;
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800005') = 0, 'rascunho: estoque mudou');
  perform pg_temp.afirmar(not exists (select 1 from public.estoque_movimentos where org_id = O and referencia_externa = 'rep-rascunho'),
    'rascunho: movimento gravado');
  -- item fora do pedido também recusa e desfaz.
  begin
    perform public.registrar_entrada(O, '09800008', 5, null, null, null, U, 'rep-sem-item', '98000000-0000-0000-0000-000000000503');
    raise exception 'FALHA: entrada de SKU fora do pedido aceita';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
  end;
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800008') = 0, 'sem item: estoque mudou');

  -- outro fornecedor: nota do CNPJ B num pedido do fornecedor A (CNPJ diferente) → erro, nada gravado.
  begin
    perform public.importar_nota_compra(O, U, nota_a, itens_a, '98000000-0000-0000-0000-000000000506');
    raise exception 'FALHA: nota de outro fornecedor aceita';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    perform pg_temp.afirmar(sqlerrm like '%pedido de outro fornecedor%', 'outro fornecedor: mensagem ' || sqlerrm);
  end;
  perform pg_temp.afirmar(not exists (select 1 from public.estoque_movimentos where org_id = O
    and referencia_externa like 'nfe:' || (nota_a->>'chave') || ':%'), 'outro fornecedor: movimento gravado');
  perform pg_temp.afirmar(not exists (select 1 from public.notas_compra where org_id = O and chave = nota_a->>'chave'),
    'outro fornecedor: nota gravada');
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800006') = 0, 'outro fornecedor: estoque');

  -- fornecedor sem CNPJ e SEM a confirmação do operador: recusa, nada gravado (nem o CNPJ, nem a nota, nem estoque).
  begin
    perform public.importar_nota_compra(O, U, nota_b, itens_b, '98000000-0000-0000-0000-000000000507');
    raise exception 'FALHA: nota em pedido de fornecedor sem CNPJ aceita sem confirmação';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    perform pg_temp.afirmar(sqlerrm like '%confirme%CNPJ%', 'sem confirmação: mensagem ' || sqlerrm);
  end;
  perform pg_temp.afirmar((select cnpj from public.fornecedores where id = '98000000-0000-0000-0000-000000000403') is null,
    'sem confirmação: CNPJ gravado');
  perform pg_temp.afirmar(not exists (select 1 from public.notas_compra where org_id = O and chave = nota_b->>'chave'),
    'sem confirmação: nota gravada');
  perform pg_temp.afirmar((select recebida from public.pedidos_compra_itens where pedido_id = '98000000-0000-0000-0000-000000000507') = 0,
    'sem confirmação: pedido baixado');
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800007') = 0, 'sem confirmação: estoque');

  -- com a confirmação: grava o CNPJ, baixa só o SKU do pedido; desfazer volta (aprovado, sem enviado_em).
  v_nota := (public.importar_nota_compra(O, U, nota_b, itens_b, '98000000-0000-0000-0000-000000000507', true)->>'nota_id')::uuid;
  select i.recebida, p.status into v_rec, v_st from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
   where i.pedido_id = '98000000-0000-0000-0000-000000000507';
  perform pg_temp.afirmar(v_rec = 2 and v_st = 'parcial', 'nota: ' || v_rec || ' ' || v_st);
  perform pg_temp.afirmar((select cnpj from public.fornecedores where id = '98000000-0000-0000-0000-000000000403') = '11222333000181',
    'nota: CNPJ não gravado');
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800008') = 1, 'nota: SKU fora do pedido');
  -- reimportar a mesma nota (duplicada) não soma de novo.
  perform public.importar_nota_compra(O, U, nota_b, itens_b, '98000000-0000-0000-0000-000000000507');
  perform pg_temp.afirmar((select recebida from public.pedidos_compra_itens where pedido_id = '98000000-0000-0000-0000-000000000507') = 2,
    'nota duplicada somou');

  perform public.desfazer_nota_compra(O, U, v_nota, 'desfeita');
  select i.recebida, p.status into v_rec, v_st from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
   where i.pedido_id = '98000000-0000-0000-0000-000000000507';
  perform pg_temp.afirmar(v_rec = 0 and v_st = 'aprovado', 'desfazer nota: ' || v_rec || ' ' || v_st);
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800007') = 0, 'desfazer nota: estoque');

  -- excedente em duas linhas: importa, fecha em 10, estoque +12; desfazer volta a 0.
  v_nota := (public.importar_nota_compra(O, U, nota_c, itens_c, '98000000-0000-0000-0000-000000000508', true)->>'nota_id')::uuid;
  select i.recebida, p.status into v_rec, v_st from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
   where i.pedido_id = '98000000-0000-0000-0000-000000000508';
  perform pg_temp.afirmar(v_rec = 10 and v_st = 'recebido', 'nota excedente: ' || v_rec || ' ' || v_st);
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800009') = 12, 'nota excedente: estoque');
  perform public.desfazer_nota_compra(O, U, v_nota, 'desfeita');
  select i.recebida, p.status into v_rec, v_st from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
   where i.pedido_id = '98000000-0000-0000-0000-000000000508';
  perform pg_temp.afirmar(v_rec = 0 and v_st = 'enviado', 'nota excedente desfeita: ' || v_rec || ' ' || v_st);

  -- Ref já lançada (entrada sem pedido) + mesma ref com pedido: devolve null e não grava recebimento.
  perform public.registrar_entrada(O, '09800003', 1, null, null, null, U, 'rep-pre-existente');
  perform pg_temp.afirmar(public.registrar_entrada(O, '09800003', 1, null, null, null, U, 'rep-pre-existente',
    '98000000-0000-0000-0000-000000000503') is null, 'ref existente: não devolveu null');
  perform pg_temp.afirmar(not exists (select 1 from public.pedidos_compra_recebimentos
    where org_id = O and referencia_externa = 'rep-pre-existente'), 'ref existente: recebimento órfão gravado');
  perform pg_temp.afirmar((select recebida from public.pedidos_compra_itens
    where pedido_id = '98000000-0000-0000-0000-000000000503') = 3, 'ref existente: recebida mudou');

  -- Sem p_pedido_compra: entrada como hoje, nenhum recebimento.
  select count(*) into v_movs from public.pedidos_compra_recebimentos where org_id = O;
  v_est := public.registrar_entrada(O, '09800005', 2, null, null, null, U, 'rep-sem-pedido');
  perform pg_temp.afirmar(v_est = 2, 'sem pedido: retorno');
  perform pg_temp.afirmar((select count(*) from public.pedidos_compra_recebimentos where org_id = O) = v_movs, 'sem pedido: recebimento gravado');
end $$;

-- Task 7 (rodada 1, migration reposicao_entrada_lote): entrada manual em várias cores com pedido é UMA transação.
do $$
declare
  O constant uuid := '98000000-0000-0000-0000-000000000001';
  U constant uuid := '98000000-0000-0000-0000-000000000101';
  P501 constant uuid := '98000000-0000-0000-0000-000000000501';
  r jsonb; v_rec int; v_st text; v_est5 int;
begin
  v_est5 := (select estoque from public.variacoes where org_id = O and codigo = '09800005');
  -- (a) lote misto: cor sem pedido (09800005) + cor marcada com pedido que não está nele (09800008) → nada gravado.
  begin
    perform public.registrar_entrada_lote(O, '[{"codigo":"09800005","quantidade":3,"custo":null,"ref":"lote-a:09800005","com_pedido":false},
      {"codigo":"09800008","quantidade":1,"custo":null,"ref":"lote-a:09800008","com_pedido":true}]'::jsonb, 'NF L', null, U, P501);
    raise exception 'FALHA: lote com cor fora do pedido aceito';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    perform pg_temp.afirmar(sqlerrm like '%não está neste pedido%', 'lote misto: mensagem ' || sqlerrm);
  end;
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800005') = v_est5, 'lote misto: estoque da cor sem pedido mudou');
  perform pg_temp.afirmar(not exists (select 1 from public.estoque_movimentos where org_id = O and referencia_externa like 'lote-a:%'),
    'lote misto: movimento gravado');
  -- (b) pedido encerrado: recusa antes de qualquer cor, inclusive a sem pedido.
  begin
    perform public.registrar_entrada_lote(O, '[{"codigo":"09800005","quantidade":3,"custo":null,"ref":"lote-b:09800005","com_pedido":false},
      {"codigo":"09800001","quantidade":1,"custo":null,"ref":"lote-b:09800001","com_pedido":true}]'::jsonb, null, null, U,
      '98000000-0000-0000-0000-000000000509');
    raise exception 'FALHA: lote em pedido saldo_encerrado aceito';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    perform pg_temp.afirmar(sqlerrm like '%saldo_encerrado%', 'lote encerrado: mensagem ' || sqlerrm);
  end;
  perform pg_temp.afirmar(not exists (select 1 from public.estoque_movimentos where org_id = O and referencia_externa like 'lote-b:%'),
    'lote encerrado: movimento gravado');
  -- (c) sucesso: cor do pedido baixa, cor fora entra sem baixa; retry com as mesmas refs não soma.
  r := public.registrar_entrada_lote(O, '[{"codigo":"09800001","quantidade":4,"custo":null,"ref":"lote-c:09800001","com_pedido":true},
    {"codigo":"09800005","quantidade":1,"custo":null,"ref":"lote-c:09800005","com_pedido":false}]'::jsonb, null, null, U, P501);
  perform pg_temp.afirmar(r = jsonb_build_array(
    jsonb_build_object('codigo','09800001','codigo_pai','09800000','estoque',(select estoque from public.variacoes where org_id = O and codigo = '09800001'),'duplicada',false),
    jsonb_build_object('codigo','09800005','codigo_pai','09800000','estoque',v_est5 + 1,'duplicada',false)), 'lote ok: retorno ' || r::text);
  select i.recebida, p.status into v_rec, v_st from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
   where i.pedido_id = P501;
  perform pg_temp.afirmar(v_rec = 4 and v_st = 'parcial', 'lote ok: ' || v_rec || ' ' || v_st);
  perform pg_temp.afirmar(not exists (select 1 from public.pedidos_compra_recebimentos where referencia_externa = 'lote-c:09800005'),
    'lote ok: cor fora do pedido baixou');
  r := public.registrar_entrada_lote(O, '[{"codigo":"09800001","quantidade":4,"custo":null,"ref":"lote-c:09800001","com_pedido":true},
    {"codigo":"09800005","quantidade":1,"custo":null,"ref":"lote-c:09800005","com_pedido":false}]'::jsonb, null, null, U, P501);
  perform pg_temp.afirmar((r->0->>'duplicada')::boolean and (r->1->>'duplicada')::boolean and (r->1->>'estoque')::int = v_est5 + 1,
    'lote retry: ' || r::text);
  perform pg_temp.afirmar((select recebida from public.pedidos_compra_itens where pedido_id = P501) = 4, 'lote retry: recebida somou');
  perform pg_temp.afirmar((select estoque from public.variacoes where org_id = O and codigo = '09800005') = v_est5 + 1, 'lote retry: estoque somou');
end $$;
reset role;

-- ACL e ordem de locks da RPC de lote.
do $$
declare d text := pg_get_functiondef('public.registrar_entrada_lote(uuid, jsonb, text, text, uuid, uuid)'::regprocedure);
begin
  perform pg_temp.afirmar(not has_function_privilege('authenticated', 'public.registrar_entrada_lote(uuid, jsonb, text, text, uuid, uuid)', 'execute'),
    'lote: authenticated executa');
  perform pg_temp.afirmar(not has_function_privilege('anon', 'public.registrar_entrada_lote(uuid, jsonb, text, text, uuid, uuid)', 'execute'),
    'lote: anon executa');
  perform pg_temp.afirmar((select pg_get_userbyid(proowner) from pg_proc
    where oid = 'public.registrar_entrada_lote(uuid, jsonb, text, text, uuid, uuid)'::regprocedure) = 'estoque_rpc_executor', 'lote: dono');
  perform pg_temp.afirmar(position('reposicao_validar_pedido' in d) < position('jsonb_array_elements' in d), 'lote: pedido não travado primeiro');
end $$;

rollback;
