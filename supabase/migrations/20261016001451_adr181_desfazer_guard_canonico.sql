-- ADR-0181, correção 2 da revisão da Task 2: guard do canônico no desfazer_nota_compra.
-- ajustar_estoque (inalterada) resolve o canônico pelo código; depois de cada ajuste, confere que
-- é o id travado. Divergência → 40001, a transação inteira aborta (nada ajustado pela metade).
-- Resto igual à 20261015235604 (advisory lock primeiro, id+saldo FOR UPDATE, contrato, grants).

create or replace function public.desfazer_nota_compra(
  p_org uuid, p_user uuid, p_nota_id uuid, p_status text
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_chave text; v_numero int; v_status text; r record; v_faltas text; v_pais jsonb;
  v_id uuid; v_saldo int;
begin
  if p_status not in ('desfeita','cancelada') then
    raise exception 'desfazer_nota_compra: status inválido %', p_status using errcode = '22023';
  end if;
  select chave into v_chave from public.notas_compra where id = p_nota_id and org_id = p_org;
  if v_chave is null then raise exception 'desfazer_nota_compra: nota não encontrada' using errcode = 'P0002'; end if;

  perform pg_advisory_xact_lock(hashtextextended('nfe:' || p_org::text || ':' || v_chave, 0));

  select numero, status into v_numero, v_status from public.notas_compra
   where id = p_nota_id and org_id = p_org for update;

  if v_status = 'importada' then
    create temp table if not exists _nfe_desfazer (codigo text, id uuid, qtd int, saldo int) on commit drop;
    truncate _nfe_desfazer;

    -- Trava a variação CANÔNICA de cada SKU (ordem determinística) e lê o saldo na mesma linha travada.
    for r in select d.codigo, sum(d.quantidade)::int as qtd
               from public.notas_compra_distribuicao d join public.notas_compra_itens i on i.id = d.item_id
              where i.nota_id = p_nota_id group by d.codigo order by d.codigo loop
      v_id := null; v_saldo := null;
      select v.id, v.estoque into v_id, v_saldo
        from public.variacoes v join public.familias f on f.id = v.familia_id
       where v.org_id = p_org and v.codigo = r.codigo
       order by f.criado_em desc limit 1
       for update of v;
      insert into _nfe_desfazer values (r.codigo, v_id, r.qtd, v_saldo);
    end loop;

    select string_agg(codigo || ' (saldo ' || saldo || ', nota ' || qtd || ')', ', ' order by codigo)
      into v_faltas from _nfe_desfazer where saldo < qtd;
    if v_faltas is not null then
      raise exception 'desfazer_nota_compra: saldo insuficiente em %', v_faltas using errcode = '23514';
    end if;

    for r in select * from _nfe_desfazer order by codigo loop
      perform public.ajustar_estoque(p_org, r.codigo, r.saldo - r.qtd,
        case p_status when 'desfeita' then 'Desfazer NF-e ' else 'NF-e cancelada ' end || v_numero,
        p_user, 'nfe-desfazer:' || v_chave || ':' || r.codigo);
      -- ajustar_estoque resolve o canônico de novo pelo código; se não for a linha travada
      -- (família nova inserida no meio), aborta tudo em vez de ajustar a linha errada.
      if (select v.id from public.variacoes v join public.familias f on f.id = v.familia_id
           where v.org_id = p_org and v.codigo = r.codigo
           order by f.criado_em desc limit 1) is distinct from r.id then
        raise exception 'desfazer_nota_compra: o produto % mudou durante o desfazer; tente de novo', r.codigo
          using errcode = '40001';
      end if;
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

revoke all on function public.desfazer_nota_compra(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.desfazer_nota_compra(uuid, uuid, uuid, text) to service_role;
