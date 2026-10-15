-- ADR-0181 D-4/D-11. security INVOKER: roda como o chamador (service_role, via edge), que já
-- executa registrar_entrada/ajustar_estoque (ambas definer, owner estoque_rpc_executor).
-- Uma chamada = uma transação.

create or replace function public.importar_nota_compra(
  p_org uuid, p_user uuid, p_nota jsonb, p_itens jsonb
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_chave text := p_nota->>'chave';
  v_nota uuid; v_status text; v_item jsonb; v_item_id uuid; v_d jsonb; v_doc text; v_pais jsonb;
  v_ref text; v_ret integer; v_lancada integer; v_orfas text;
begin
  -- Serializa importações concorrentes da MESMA nota: a segunda espera e cai em "duplicada"
  -- em vez de estourar a unique (org_id, chave).
  perform pg_advisory_xact_lock(hashtextextended('nfe:' || p_org::text || ':' || v_chave, 0));

  select id, status into v_nota, v_status from public.notas_compra
   where org_id = p_org and chave = v_chave;

  if v_nota is not null and v_status <> 'importada' then
    raise exception 'importar_nota_compra: a nota % está %; não pode ser reimportada', v_chave, v_status
      using errcode = '23514';
  end if;

  if v_nota is null then
    insert into public.notas_compra (org_id, chave, numero, serie, emitente_cnpj, emitente_nome,
      emitida_em, valor_total, assinada, xml_path, xml_sha256, divergencia_total_aceita, importada_por)
    values (p_org, v_chave, (p_nota->>'numero')::int, (p_nota->>'serie')::int,
      p_nota->>'emitente_cnpj', p_nota->>'emitente_nome', (p_nota->>'emitida_em')::timestamptz,
      (p_nota->>'valor_total')::numeric, (p_nota->>'assinada')::boolean, p_nota->>'xml_path',
      p_nota->>'xml_sha256', nullif(p_nota->>'divergencia_total_aceita', '')::numeric, p_user)
    returning id into v_nota;

    v_doc := 'NF-e ' || (p_nota->>'numero') || ' · ' || (p_nota->>'emitente_nome');

    for v_item in select * from jsonb_array_elements(p_itens) loop
      insert into public.notas_compra_itens (nota_id, org_id, n_item, cprod, xprod, ncm, cfop, gtin,
        ucom, qcom, fator_conversao, v_prod, v_frete, v_seg, v_desc, v_outro, v_ipi, v_st, v_fcpst, rateio,
        orig, codigo_pai)
      values (v_nota, p_org, (v_item->>'n_item')::smallint, v_item->>'cprod', v_item->>'xprod',
        v_item->>'ncm', v_item->>'cfop', v_item->>'gtin', v_item->>'ucom', (v_item->>'qcom')::numeric,
        (v_item->>'fator_conversao')::int, (v_item->>'v_prod')::numeric, (v_item->>'v_frete')::numeric,
        (v_item->>'v_seg')::numeric, (v_item->>'v_desc')::numeric, (v_item->>'v_outro')::numeric,
        (v_item->>'v_ipi')::numeric, (v_item->>'v_st')::numeric, coalesce((v_item->>'v_fcpst')::numeric, 0),
        coalesce(v_item->'rateio', '{}'::jsonb),
        (v_item->>'orig')::smallint, v_item->>'codigo_pai')
      returning id into v_item_id;

      insert into public.vinculos_fornecedor (org_id, cnpj_fornecedor, cprod, codigo_pai, fator_conversao)
      values (p_org, p_nota->>'emitente_cnpj', v_item->>'cprod', v_item->>'codigo_pai',
        (v_item->>'fator_conversao')::int)
      on conflict (org_id, cnpj_fornecedor, cprod) do update
        set codigo_pai = excluded.codigo_pai, fator_conversao = excluded.fator_conversao,
            atualizado_em = now();

      for v_d in select * from jsonb_array_elements(v_item->'distribuicao') loop
        insert into public.notas_compra_distribuicao (item_id, org_id, codigo, quantidade,
          custo_aquisicao_unit, custo_precificacao_unit)
        values (v_item_id, p_org, v_d->>'codigo', (v_d->>'quantidade')::int,
          (v_d->>'custo_aquisicao_unit')::numeric, (v_d->>'custo_precificacao_unit')::numeric);

        -- Ledger guarda o custo de PRECIFICAÇÃO (D-3); o de aquisição fica na nota.
        v_ref := 'nfe:' || v_chave || ':' || (v_item->>'n_item') || ':' || (v_d->>'codigo');
        v_ret := public.registrar_entrada(p_org, v_d->>'codigo', (v_d->>'quantidade')::int,
          (v_d->>'custo_precificacao_unit')::numeric, v_doc, null, p_user, v_ref);
        if v_ret is null then
          -- Ref já aplicada: a variação nasceu pelo fluxo existente com a referência da nota (D-8).
          -- A quantidade lançada tem de ser a da nota, senão a nota e o ledger divergem.
          select m.quantidade into v_lancada from public.estoque_movimentos m
           where m.org_id = p_org and m.referencia_externa = v_ref;
          if v_lancada is distinct from (v_d->>'quantidade')::int then
            raise exception 'importar_nota_compra: % já recebeu % unidades por esta nota; a distribuição diz %',
              v_d->>'codigo', v_lancada, v_d->>'quantidade' using errcode = '23514';
          end if;
          -- R5-I1: registrar_entrada não atualiza o custo quando a ref é duplicada. O custo confirmado
          -- na nota vai para a variação canônica (só custo; saldo e ledger intocados).
          update public.variacoes v set custo = (v_d->>'custo_precificacao_unit')::numeric
           where v.id = (select v2.id from public.variacoes v2 join public.familias f on f.id = v2.familia_id
                          where v2.org_id = p_org and v2.codigo = v_d->>'codigo' order by f.criado_em desc limit 1);
        end if;
      end loop;
    end loop;

    -- R3-B1: toda entrada já lançada com a ref desta nota (ex.: variação criada pela D-8) tem de
    -- estar na distribuição confirmada. Senão a nota de 35 viraria 40 no estoque.
    select string_agg(m.codigo, ', ' order by m.codigo) into v_orfas
      from public.estoque_movimentos m
     where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%'
       and not exists (
         select 1 from public.notas_compra_distribuicao d
           join public.notas_compra_itens i on i.id = d.item_id
          where i.nota_id = v_nota
            and m.referencia_externa = 'nfe:' || v_chave || ':' || i.n_item || ':' || d.codigo);
    if v_orfas is not null then
      raise exception 'importar_nota_compra: já houve entrada por esta nota em % fora da distribuição', v_orfas
        using errcode = '23514';
    end if;
  end if;

  -- Produtos tocados lidos do LEDGER (distribuição pode cair em outro produto, D-7).
  select coalesce(jsonb_agg(distinct m.codigo_pai), '[]'::jsonb) into v_pais
    from public.estoque_movimentos m
   where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%';

  return jsonb_build_object('nota_id', v_nota, 'duplicada', v_status is not null, 'codigos_pai', v_pais);
end $$;

create or replace function public.desfazer_nota_compra(
  p_org uuid, p_user uuid, p_nota_id uuid, p_status text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_chave text; v_numero int; v_status text; r record; v_faltas text; v_pais jsonb;
begin
  if p_status not in ('desfeita','cancelada') then
    raise exception 'desfazer_nota_compra: status inválido %', p_status using errcode = '22023';
  end if;
  select chave, numero, status into v_chave, v_numero, v_status from public.notas_compra
   where id = p_nota_id and org_id = p_org for update;
  if v_chave is null then raise exception 'desfazer_nota_compra: nota não encontrada' using errcode = 'P0002'; end if;

  if v_status = 'importada' then
    -- Trava as variações CANÔNICAS de todos os SKUs da nota, em ordem determinística, ANTES
    -- de ler saldo: venda/entrada concorrente espera, e o ajuste absoluto não apaga movimento.
    perform 1 from public.variacoes v
     where v.id in (
       select (select v2.id from public.variacoes v2 join public.familias f on f.id = v2.familia_id
                where v2.org_id = p_org and v2.codigo = d.codigo order by f.criado_em desc limit 1)
         from public.notas_compra_distribuicao d join public.notas_compra_itens i on i.id = d.item_id
        where i.nota_id = p_nota_id)
     order by v.codigo for update;

    create temp table if not exists _nfe_desfazer (codigo text, qtd int, saldo int) on commit drop;
    truncate _nfe_desfazer;
    insert into _nfe_desfazer
    select d.codigo, sum(d.quantidade)::int,
      (select v.estoque from public.variacoes v join public.familias f on f.id = v.familia_id
        where v.org_id = p_org and v.codigo = d.codigo order by f.criado_em desc limit 1)
      from public.notas_compra_distribuicao d join public.notas_compra_itens i on i.id = d.item_id
     where i.nota_id = p_nota_id group by d.codigo;

    select string_agg(codigo || ' (saldo ' || saldo || ', nota ' || qtd || ')', ', ' order by codigo)
      into v_faltas from _nfe_desfazer where saldo < qtd;
    if v_faltas is not null then
      raise exception 'desfazer_nota_compra: saldo insuficiente em %', v_faltas using errcode = '23514';
    end if;

    for r in select * from _nfe_desfazer order by codigo loop
      perform public.ajustar_estoque(p_org, r.codigo, r.saldo - r.qtd,
        case p_status when 'desfeita' then 'Desfazer NF-e ' else 'NF-e cancelada ' end || v_numero,
        p_user, 'nfe-desfazer:' || v_chave || ':' || r.codigo);
    end loop;

    update public.notas_compra set status = p_status, desfeita_por = p_user, desfeita_em = now()
     where id = p_nota_id;
  end if;

  -- Já desfeita/cancelada: no-op financeiro. Devolve os produtos para o retry reenfileirar o push.
  select coalesce(jsonb_agg(distinct m.codigo_pai), '[]'::jsonb) into v_pais
    from public.estoque_movimentos m
   where m.org_id = p_org and m.referencia_externa like 'nfe:' || v_chave || ':%';
  return jsonb_build_object('codigos_pai', v_pais, 'ja_estava', v_status <> 'importada');
end $$;

-- D-8 / R3-B1 (rodada 4): entrada de variação nova com a ref de uma nota AINDA NÃO importada. Pega o
-- MESMO advisory lock da importação: depois que a nota fecha (qualquer status), recusa — senão uma aba
-- antiga somaria peças fora da distribuição já confirmada.
create or replace function public.registrar_entrada_nota_pendente(
  p_org uuid, p_chave text, p_codigo text, p_qtd integer, p_custo numeric, p_doc text, p_user uuid, p_ref text
) returns integer language plpgsql security invoker set search_path = ''
as $$
begin
  if p_ref not like 'nfe:' || p_chave || ':%' then
    raise exception 'registrar_entrada_nota_pendente: ref % não pertence à nota %', p_ref, p_chave using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nfe:' || p_org::text || ':' || p_chave, 0));
  if exists (select 1 from public.notas_compra where org_id = p_org and chave = p_chave) then
    raise exception 'registrar_entrada_nota_pendente: a nota % já foi importada; adicione o tamanho/cor sem a nota', p_chave
      using errcode = '23514';
  end if;
  return public.registrar_entrada(p_org, p_codigo, p_qtd, p_custo, p_doc, null, p_user, p_ref);
end $$;
revoke all on function public.registrar_entrada_nota_pendente(uuid, text, text, integer, numeric, text, uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_entrada_nota_pendente(uuid, text, text, integer, numeric, text, uuid, text) to service_role;

-- Produtos tocados pela nota (importação e desfazer), para o "Reenviar estoque" (R3-I4: sem
-- paginação de PostgREST, distinto no banco).
create or replace function public.codigos_pai_da_nota(p_org uuid, p_chave text)
returns text[] language sql stable security invoker set search_path = ''
as $$
  select coalesce(array_agg(distinct m.codigo_pai), '{}')
    from public.estoque_movimentos m
   where m.org_id = p_org
     and (m.referencia_externa like 'nfe:' || p_chave || ':%'
          or m.referencia_externa like 'nfe-desfazer:' || p_chave || ':%');
$$;
revoke all on function public.codigos_pai_da_nota(uuid, text) from public, anon, authenticated;
grant execute on function public.codigos_pai_da_nota(uuid, text) to service_role;

revoke all on function public.importar_nota_compra(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.desfazer_nota_compra(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.importar_nota_compra(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.desfazer_nota_compra(uuid, uuid, uuid, text) to service_role;
