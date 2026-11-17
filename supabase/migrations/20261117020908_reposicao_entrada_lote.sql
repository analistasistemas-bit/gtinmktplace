-- ADR-0207 §16 — entrada manual VINCULADA a um pedido de compra em várias cores numa transação só.
-- `registrar_entrada` é uma RPC por cor; com pedido, a recusa de uma cor deixaria as outras gravadas (HTTP 200
-- com entrada parcial). Aqui todas as cores passam por `registrar_entrada` DENTRO da mesma função: qualquer `raise`
-- desfaz o lote inteiro. A edge só usa esta RPC quando há pedido; sem pedido, o caminho por cor fica como está.
--
-- Itens: [{codigo, quantidade, custo, ref, com_pedido}]. `com_pedido` = a cor está no pedido escolhido e baixa;
-- as outras entram sem baixa. `ref` é a referência de idempotência de cada cor (a mesma do caminho por cor).
-- Ordem de locks: pedido primeiro (antes de qualquer variação), como na entrada de uma cor e na nota.
-- Retorno: [{codigo, codigo_pai, estoque, duplicada}] lido do movimento (duplicada = ref já aplicada).
grant estoque_rpc_executor to postgres;
grant usage, create on schema public to estoque_rpc_executor;

create or replace function public.registrar_entrada_lote(
  p_org uuid, p_itens jsonb, p_doc text, p_obs text, p_criado_por uuid, p_pedido_compra uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_it jsonb; v_ret integer; v_out jsonb := '[]'::jsonb; v_pai text; v_est integer;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'registrar_entrada_lote: informe ao menos um item' using errcode = '22023';
  end if;
  -- Trava e valida o pedido (org e status) antes de tocar qualquer variação; o SKU é validado por cor abaixo.
  if p_pedido_compra is not null then
    perform public.reposicao_validar_pedido(p_org, p_pedido_compra, null);
  end if;

  for v_it in select * from jsonb_array_elements(p_itens) loop
    v_ret := public.registrar_entrada(
      p_org, v_it->>'codigo', (v_it->>'quantidade')::int, (v_it->>'custo')::numeric, p_doc, p_obs, p_criado_por,
      v_it->>'ref',
      case when coalesce((v_it->>'com_pedido')::boolean, false) then p_pedido_compra end);
    select m.codigo_pai, m.estoque_resultante into v_pai, v_est
      from public.estoque_movimentos m where m.org_id = p_org and m.referencia_externa = v_it->>'ref';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'codigo', v_it->>'codigo', 'codigo_pai', v_pai, 'estoque', coalesce(v_ret, v_est), 'duplicada', v_ret is null));
  end loop;
  return v_out;
end $$;

revoke all on function public.registrar_entrada_lote(uuid, jsonb, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.registrar_entrada_lote(uuid, jsonb, text, text, uuid, uuid) to service_role;
alter function public.registrar_entrada_lote(uuid, jsonb, text, text, uuid, uuid) owner to estoque_rpc_executor;

revoke create on schema public from estoque_rpc_executor;
-- Tolerante como em 20261116231928: o membership de postgres tem grantor supabase_admin.
do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;
