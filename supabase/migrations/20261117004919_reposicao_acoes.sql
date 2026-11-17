-- ADR-0207 — ações do pedido de compra atômicas (revisão da Task 4): salvar rascunho, editar pedido, encerrar e
-- reabrir saldo. Cada uma valida, muda os itens e recalcula o status numa transação, sob o lock do pedido.
-- Ordem de locks igual à das RPCs de recebimento (20261116231928_reposicao.sql): `pedidos_compra ... for update`
-- primeiro; nenhuma destas toca variações. Status pela função única `reposicao_recalcular_status` (executável pelo
-- dono destas funções, não pelo service_role). Chamadas só pela edge `reposicao` (service role).

-- Rascunho do fornecedor: com `p_pedido`, exige que ele ainda seja rascunho (aprovado no meio → erro, nada muda);
-- sem, usa o rascunho do fornecedor ou cria um. Itens com quantidade 0 saem; rascunho sem item é apagado (null).
create or replace function public.reposicao_salvar_rascunho(
  p_org uuid, p_fornecedor uuid, p_pedido uuid, p_usuario uuid, p_previsto date, p_mudar_previsto boolean, p_itens jsonb
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_status text;
begin
  if p_pedido is not null then
    select id, status into v_id, v_status from public.pedidos_compra
     where id = p_pedido and org_id = p_org and fornecedor_id = p_fornecedor for update;
    if not found then
      raise exception 'reposicao_salvar_rascunho: rascunho não encontrado nesta organização' using errcode = 'P0002';
    end if;
    if v_status <> 'rascunho' then
      raise exception 'reposicao_salvar_rascunho: o pedido deixou de ser rascunho (está %); recarregue a tela', v_status
        using errcode = '23514';
    end if;
  else
    select id into v_id from public.pedidos_compra
     where org_id = p_org and fornecedor_id = p_fornecedor and status = 'rascunho' for update;
    if v_id is null then
      begin
        insert into public.pedidos_compra (org_id, fornecedor_id, status, criado_por)
        values (p_org, p_fornecedor, 'rascunho', p_usuario) returning id into v_id;
      exception when unique_violation then
        -- outro membro criou o rascunho no mesmo instante: usa o dele
        select id into v_id from public.pedidos_compra
         where org_id = p_org and fornecedor_id = p_fornecedor and status = 'rascunho' for update;
      end;
    end if;
  end if;

  update public.pedidos_compra
     set salvo_por = p_usuario, salvo_em = now(),
         previsto_para = case when p_mudar_previsto then p_previsto else previsto_para end
   where id = v_id;

  insert into public.pedidos_compra_itens (pedido_id, org_id, codigo, codigo_pai, quantidade, sugerida)
  select v_id, p_org, i->>'codigo', i->>'codigo_pai', (i->>'quantidade')::int, (i->>'sugerida')::int
    from jsonb_array_elements(p_itens) i
   where (i->>'quantidade')::int > 0
  on conflict (pedido_id, codigo) do update
    set codigo_pai = excluded.codigo_pai, quantidade = excluded.quantidade, sugerida = excluded.sugerida;
  delete from public.pedidos_compra_itens
   where pedido_id = v_id
     and codigo in (select i->>'codigo' from jsonb_array_elements(p_itens) i where (i->>'quantidade')::int = 0);

  if not exists (select 1 from public.pedidos_compra_itens where pedido_id = v_id) then
    delete from public.pedidos_compra where id = v_id;
    return null;
  end if;
  return v_id;
end $$;

-- Edição (quantidade e data) até o primeiro recebimento, mesmo desfeito (a FK restrict do recebimento impede apagar
-- o item). Quantidade 0 tira o item; pedido não fica vazio.
-- Status recalculado no fim pela mesma regra de encerrar_saldo (fora do rascunho).
create or replace function public.reposicao_editar_pedido(
  p_org uuid, p_pedido uuid, p_usuario uuid, p_previsto date, p_itens jsonb, p_pode_aprovado boolean default false
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_status text; v_fora text;
begin
  select status into v_status from public.pedidos_compra where id = p_pedido and org_id = p_org for update;
  if not found then
    raise exception 'reposicao_editar_pedido: pedido não encontrado nesta organização' using errcode = 'P0002';
  end if;
  -- Pedido já aprovado só muda por quem aprova (admin ou suporte full); a edge decide `p_pode_aprovado`. Sob o lock:
  -- rascunho aprovado no meio da edição de um membro também recusa.
  if v_status <> 'rascunho' and not coalesce(p_pode_aprovado, false) then
    raise exception 'reposicao_editar_pedido: só administrador altera pedido já aprovado' using errcode = '42501';
  end if;
  if exists (select 1 from public.pedidos_compra_recebimentos where pedido_id = p_pedido) then
    raise exception 'reposicao_editar_pedido: o pedido já teve recebimento e não pode mais ser editado' using errcode = '23514';
  end if;
  if v_status not in ('rascunho','aprovado','enviado') then
    raise exception 'reposicao_editar_pedido: o pedido está % e não pode mais ser editado', v_status using errcode = '23514';
  end if;
  select i->>'codigo' into v_fora from jsonb_array_elements(p_itens) i
   where not exists (select 1 from public.pedidos_compra_itens x where x.pedido_id = p_pedido and x.codigo = i->>'codigo')
   limit 1;
  if v_fora is not null then
    raise exception 'reposicao_editar_pedido: o produto % não está neste pedido', v_fora using errcode = '22023';
  end if;

  update public.pedidos_compra_itens x set quantidade = (i->>'quantidade')::int
    from jsonb_array_elements(p_itens) i
   where x.pedido_id = p_pedido and x.codigo = i->>'codigo' and (i->>'quantidade')::int > 0;
  delete from public.pedidos_compra_itens
   where pedido_id = p_pedido
     and codigo in (select i->>'codigo' from jsonb_array_elements(p_itens) i where (i->>'quantidade')::int = 0);
  if not exists (select 1 from public.pedidos_compra_itens where pedido_id = p_pedido) then
    raise exception 'reposicao_editar_pedido: o pedido ficaria sem itens' using errcode = '22023';
  end if;

  update public.pedidos_compra set previsto_para = p_previsto, alterado_por = p_usuario, alterado_em = now()
   where id = p_pedido;

  -- Tirar o último item aberto muda o status (ex.: A encerrado e B removido → só saldo encerrado). Rascunho fica.
  if v_status <> 'rascunho' then
    v_status := public.reposicao_recalcular_status(p_pedido);
    if v_status = 'recebido' and exists (select 1 from public.pedidos_compra_itens
                                          where pedido_id = p_pedido and encerrado and recebida < quantidade) then
      update public.pedidos_compra set status = 'saldo_encerrado' where id = p_pedido;
    end if;
  end if;
end $$;

-- Encerrar saldo: o restante não vem. Itens com saldo (todos, ou `p_codigos`) ficam encerrados; status pelas
-- quantidades atuais. Sem nada aberto e com saldo encerrado, o pedido fica `saldo_encerrado`.
create or replace function public.reposicao_encerrar_saldo(p_org uuid, p_pedido uuid, p_codigos text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_status text; v_cods text[];
begin
  select status into v_status from public.pedidos_compra where id = p_pedido and org_id = p_org for update;
  if not found then
    raise exception 'reposicao_encerrar_saldo: pedido não encontrado nesta organização' using errcode = 'P0002';
  end if;
  if v_status not in ('aprovado','enviado','parcial') then
    raise exception 'reposicao_encerrar_saldo: o pedido está %; não há saldo a encerrar', v_status using errcode = '23514';
  end if;
  with u as (
    update public.pedidos_compra_itens set encerrado = true
     where pedido_id = p_pedido and not encerrado and recebida < quantidade
       and (p_codigos is null or codigo = any(p_codigos))
    returning codigo
  )
  select coalesce(array_agg(codigo order by codigo), '{}') into v_cods from u;

  v_status := public.reposicao_recalcular_status(p_pedido);
  if v_status = 'recebido' and exists (select 1 from public.pedidos_compra_itens
                                        where pedido_id = p_pedido and encerrado and recebida < quantidade) then
    update public.pedidos_compra set status = 'saldo_encerrado' where id = p_pedido;
    v_status := 'saldo_encerrado';
  end if;
  return jsonb_build_object('status', v_status, 'codigos', to_jsonb(v_cods));
end $$;

-- Reabrir saldo (reversível, ADR-0207 §16): os itens voltam a ter saldo a caminho; status pelas quantidades atuais.
create or replace function public.reposicao_reabrir_saldo(p_org uuid, p_pedido uuid, p_codigos text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_status text; v_cods text[];
begin
  select status into v_status from public.pedidos_compra where id = p_pedido and org_id = p_org for update;
  if not found then
    raise exception 'reposicao_reabrir_saldo: pedido não encontrado nesta organização' using errcode = 'P0002';
  end if;
  if v_status not in ('aprovado','enviado','parcial','recebido','saldo_encerrado') then
    raise exception 'reposicao_reabrir_saldo: o pedido está %; não há saldo a reabrir', v_status using errcode = '23514';
  end if;
  with u as (
    update public.pedidos_compra_itens set encerrado = false
     where pedido_id = p_pedido and encerrado and (p_codigos is null or codigo = any(p_codigos))
    returning codigo
  )
  select coalesce(array_agg(codigo order by codigo), '{}') into v_cods from u;

  v_status := public.reposicao_recalcular_status(p_pedido);
  return jsonb_build_object('status', v_status, 'codigos', to_jsonb(v_cods));
end $$;

revoke all on function public.reposicao_salvar_rascunho(uuid, uuid, uuid, uuid, date, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.reposicao_editar_pedido(uuid, uuid, uuid, date, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.reposicao_encerrar_saldo(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.reposicao_reabrir_saldo(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.reposicao_salvar_rascunho(uuid, uuid, uuid, uuid, date, boolean, jsonb) to service_role;
grant execute on function public.reposicao_editar_pedido(uuid, uuid, uuid, date, jsonb, boolean) to service_role;
grant execute on function public.reposicao_encerrar_saldo(uuid, uuid, text[]) to service_role;
grant execute on function public.reposicao_reabrir_saldo(uuid, uuid, text[]) to service_role;
