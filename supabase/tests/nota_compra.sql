\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('93000000-0000-0000-0000-000000000001', 'NF test', 'nf-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93000000-0000-0000-0000-000000000101', 'nf@test.local',
   '{"org_id":"93000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro)
values ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000201',
  '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
  '09300000', 'Short teste', 'CREATE', 'nacional', gen_random_uuid()),
  ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000201',
  '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
  '09310000', 'Outro produto', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, preco, custo, estoque) values
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', '09300001', 'P', 49.9, 8, 0),
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', '09300002', 'M', 49.9, 8, 0),
  ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', '09310001', 'U', 39.9, 8, 0);

set local role service_role;

do $$
declare r jsonb; r2 jsonb; v_p integer; v_m integer; v_o integer; v_custo numeric;
  v_nota jsonb := '{"chave":"26261011222333000181550010000010511000030324","numero":1051,"serie":1,
    "emitente_cnpj":"11222333000181","emitente_nome":"Fornecedor Teste","emitida_em":"2026-10-13T15:57:33-03:00",
    "valor_total":350,"assinada":false,"xml_path":"93000000-0000-0000-0000-000000000001/x.xml","xml_sha256":"abc"}';
  -- REF genérica: 30 no produto vinculado + 5 em SKU de OUTRO produto (D-7).
  v_itens jsonb := '[{"n_item":1,"cprod":"REF 06","xprod":"Short masculino - DIV - DIV","ncm":"62034900",
    "cfop":"5102","gtin":null,"ucom":"PC","qcom":35,"fator_conversao":1,"v_prod":350,"v_frete":0,"v_seg":0,
    "v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,"rateio":{},"orig":0,"codigo_pai":"09300000",
    "distribuicao":[{"codigo":"09300001","quantidade":10,"custo_aquisicao_unit":10,"custo_precificacao_unit":14},
                    {"codigo":"09300002","quantidade":20,"custo_aquisicao_unit":10,"custo_precificacao_unit":14},
                    {"codigo":"09310001","quantidade":5,"custo_aquisicao_unit":10,"custo_precificacao_unit":14}]}]';
begin
  -- D-8: o M "nasceu" pelo fluxo existente já com as 20 peças e a ref da nota.
  perform public.registrar_entrada('93000000-0000-0000-0000-000000000001', '09300002', 20, 9, 'addvar', null,
        '93000000-0000-0000-0000-000000000101', 'nfe:26261011222333000181550010000010511000030324:1:09300002');
  r := public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', v_nota, v_itens);
  if (r->>'duplicada')::boolean then raise exception '1a importação veio duplicada'; end if;
  if (select estoque from public.variacoes where codigo='09300002') <> 20 then
    raise exception 'ref da nota já aplicada foi somada de novo (D-8)'; end if;
  -- R6-M1: a entrada prévia veio com custo 9; a nota confirma 14. Custo vira 14, saldo e movimento intactos.
  if (select custo from public.variacoes where codigo='09300002') <> 14 then
    raise exception 'custo confirmado na nota não chegou ao SKU da entrada prévia (R5-I1)'; end if;
  if (select count(*) from public.estoque_movimentos
       where referencia_externa = 'nfe:26261011222333000181550010000010511000030324:1:09300002') <> 1
     or (select custo_unitario from public.estoque_movimentos
       where referencia_externa = 'nfe:26261011222333000181550010000010511000030324:1:09300002') <> 9 then
    raise exception 'movimento original da entrada prévia foi alterado/duplicado'; end if;
  if (select array_agg(x order by x) from jsonb_array_elements_text(r->'codigos_pai') x)
     <> array['09300000','09310000'] then
    raise exception 'push precisa ir para os 2 produtos tocados: %', r; end if;
  select estoque, custo into v_p, v_custo from public.variacoes where codigo='09300001';
  if v_p <> 10 then raise exception 'estoque P esperado 10, veio %', v_p; end if;
  if v_custo <> 14 then raise exception 'custo de precificação esperado 14, veio %', v_custo; end if;

  -- Reimportação: idempotente, saldo não soma, devolve os mesmos produtos.
  r2 := public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', v_nota, v_itens);
  if not (r2->>'duplicada')::boolean then raise exception 'reimportação não marcada duplicada'; end if;
  if r2->>'nota_id' <> r->>'nota_id' then raise exception 'reimportação devolveu outra nota'; end if;
  select estoque into v_p from public.variacoes where codigo='09300001';
  if v_p <> 10 then raise exception 'reimportação somou: %', v_p; end if;

  -- Vendeu 1 do M (saldo 19 < 20 da nota): desfazer recusa inteiro, nada ajustado.
  perform public.ajustar_estoque('93000000-0000-0000-0000-000000000001', '09300002', 19, 'venda simulada',
        '93000000-0000-0000-0000-000000000101', 'teste-venda-1');
  begin
    perform public.desfazer_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', (r->>'nota_id')::uuid, 'desfeita');
    raise exception 'desfazer deveria ter recusado';
  exception when sqlstate '23514' then
    if sqlerrm not like '%09300002%' then raise exception 'mensagem não lista o SKU: %', sqlerrm; end if;
  end;
  select estoque into v_p from public.variacoes where codigo='09300001';
  if v_p <> 10 then raise exception 'desfazer recusado mexeu no P: %', v_p; end if;

  -- Repõe o M e desfaz de verdade.
  perform public.registrar_entrada('93000000-0000-0000-0000-000000000001', '09300002', 1, null, null, null,
        '93000000-0000-0000-0000-000000000101', 'teste-repoe-1');
  r2 := public.desfazer_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', (r->>'nota_id')::uuid, 'desfeita');
  select estoque into v_p from public.variacoes where codigo='09300001';
  select estoque into v_m from public.variacoes where codigo='09300002';
  select estoque into v_o from public.variacoes where codigo='09310001';
  if v_p <> 0 or v_m <> 0 or v_o <> 0 then raise exception 'desfazer não zerou: P=% M=% O=%', v_p, v_m, v_o; end if;
  if (r2->>'ja_estava')::boolean then raise exception '1o desfazer marcou ja_estava'; end if;

  -- Repetir o desfazer: no-op financeiro, devolve produtos para reenfileirar o push.
  r2 := public.desfazer_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', (r->>'nota_id')::uuid, 'desfeita');
  if not (r2->>'ja_estava')::boolean then raise exception 'repetição do desfazer não é no-op'; end if;
  if jsonb_array_length(r2->'codigos_pai') <> 2 then raise exception 'repetição sem produtos: %', r2; end if;

  -- Nota desfeita não pode ser reimportada.
  begin
    perform public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101', v_nota, v_itens);
    raise exception 'reimportar nota desfeita deveria recusar';
  exception when sqlstate '23514' then null;
  end;

  -- Ref da nota já aplicada com quantidade DIFERENTE da distribuição: recusa a nota inteira.
  perform public.registrar_entrada('93000000-0000-0000-0000-000000000001', '09310001', 3, 14, 'addvar', null,
        '93000000-0000-0000-0000-000000000101', 'nfe:26261011222333000181550010000010511000099991:1:09310001');
  begin
    perform public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101',
        jsonb_set(v_nota, '{chave}', '"26261011222333000181550010000010511000099991"'),
        '[{"n_item":1,"cprod":"REF 09","xprod":"X","ncm":null,"cfop":"5102","gtin":null,"ucom":"PC","qcom":5,
          "fator_conversao":1,"v_prod":50,"v_frete":0,"v_seg":0,"v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,
          "rateio":{},"orig":0,"codigo_pai":"09310000",
          "distribuicao":[{"codigo":"09310001","quantidade":5,"custo_aquisicao_unit":10,"custo_precificacao_unit":14}]}]');
    raise exception 'quantidade divergente da ref já aplicada deveria recusar';
  exception when sqlstate '23514' then null;
  end;
  if exists (select 1 from public.notas_compra where chave = '26261011222333000181550010000010511000099991') then
    raise exception 'nota recusada deixou registro (deveria ser atômica)'; end if;

  -- R3-B1: entrada prévia com a ref da nota num SKU que ficou FORA da distribuição → recusa.
  perform public.registrar_entrada('93000000-0000-0000-0000-000000000001', '09300001', 5, 14, 'addvar', null,
        '93000000-0000-0000-0000-000000000101', 'nfe:26261011222333000181550010000010511000099992:1:09300001');
  begin
    perform public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000101',
        jsonb_set(v_nota, '{chave}', '"26261011222333000181550010000010511000099992"'),
        '[{"n_item":1,"cprod":"REF 10","xprod":"X","ncm":null,"cfop":"5102","gtin":null,"ucom":"PC","qcom":5,
          "fator_conversao":1,"v_prod":50,"v_frete":0,"v_seg":0,"v_desc":0,"v_outro":0,"v_ipi":0,"v_st":0,
          "rateio":{},"orig":0,"codigo_pai":"09310000",
          "distribuicao":[{"codigo":"09310001","quantidade":5,"custo_aquisicao_unit":10,"custo_precificacao_unit":14}]}]');
    raise exception 'entrada prévia fora da distribuição deveria recusar';
  exception when sqlstate '23514' then
    if sqlerrm not like '%09300001%' then raise exception 'mensagem não cita o SKU órfão: %', sqlerrm; end if;
  end;

  -- registrar_entrada_nota_pendente: nota já importada (a 1a, agora desfeita) recusa; ref de outra nota recusa.
  begin
    perform public.registrar_entrada_nota_pendente('93000000-0000-0000-0000-000000000001',
      '26261011222333000181550010000010511000030324', '09300001', 5, 14, 'addvar',
      '93000000-0000-0000-0000-000000000101', 'nfe:26261011222333000181550010000010511000030324:1:09300001');
    raise exception 'entrada pendente aceitou nota já fechada';
  exception when sqlstate '23514' then null;
  end;
  begin
    perform public.registrar_entrada_nota_pendente('93000000-0000-0000-0000-000000000001',
      '26261011222333000181550010000010511000077771', '09300001', 5, 14, 'addvar',
      '93000000-0000-0000-0000-000000000101', 'nfe:99999999999999999999999999999999999999999999:1:09300001');
    raise exception 'entrada pendente aceitou ref de outra nota';
  exception when sqlstate '22023' then null;
  end;
  if public.registrar_entrada_nota_pendente('93000000-0000-0000-0000-000000000001',
      '26261011222333000181550010000010511000077771', '09300001', 5, 14, 'addvar',
      '93000000-0000-0000-0000-000000000101', 'nfe:26261011222333000181550010000010511000077771:1:09300001') is null then
    raise exception 'entrada pendente de nota ainda não importada deveria aplicar';
  end if;

  -- codigos_pai_da_nota devolve os produtos da 1a nota (importação + desfazer).
  if (select array_agg(x order by x) from unnest(public.codigos_pai_da_nota('93000000-0000-0000-0000-000000000001',
        '26261011222333000181550010000010511000030324')) x) <> array['09300000','09310000'] then
    raise exception 'codigos_pai_da_nota errado'; end if;
end $$;

-- authenticated nunca executa as RPCs (escrita só via edge/service_role).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$
begin
  begin
    perform public.importar_nota_compra('93000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000101', '{}'::jsonb, '[]'::jsonb);
    raise exception 'authenticated executou importar_nota_compra';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.desfazer_nota_compra('93000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000101', gen_random_uuid(), 'desfeita');
    raise exception 'authenticated executou desfazer_nota_compra';
  exception when insufficient_privilege then null;
  end;
  raise exception 'TESTE_OK' using errcode = 'P0001';
end $$;
rollback;
