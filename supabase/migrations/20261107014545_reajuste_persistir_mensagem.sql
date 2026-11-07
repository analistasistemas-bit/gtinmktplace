-- ADR-0196 — `aplicado` pode levar aviso: o base foi aplicado, mas as faixas de atacado não (MSG_FAIXAS_PENDENTES). Depois
-- de `aplicado`, `reajuste_item_gravar` já não grava, então a mensagem entra na mesma transação do persistir.
drop function public.reajuste_persistir(uuid, uuid, text, uuid, numeric, jsonb);
create function public.reajuste_persistir(p_org uuid, p_operacao uuid, p_ml_item text, p_token uuid,
                                          p_preco_confirmado numeric, p_restaurar jsonb,
                                          p_mensagem text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_it public.operacoes_massa_itens%rowtype;
  v_pai text;
  v_e jsonb;
  v_pub numeric;
  v_edit boolean;
  v_ids uuid[];
  v_conflito text;
begin
  select i.codigo_pai into v_pai from public.operacoes_massa_itens i
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
  if not found then raise exception 'item de reajuste não encontrado: %', p_ml_item; end if;
  if v_pai is not null then
    perform public.reajuste_trava_produto(p_org, v_pai);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rm:' || p_org || ':' || p_ml_item, 0));

  select * into v_it from public.operacoes_massa_itens i
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item
  for update;
  if not coalesce(v_it.lease_token = p_token, false) then return 'sem_posse'; end if;
  if v_it.status = 'aplicado' then return 'ja_aplicado'; end if;
  -- Só persiste quem detém a reserva; repetir depois de `erro`/`mudou` não pode gravar.
  if v_it.status not in ('enviando','conferindo') then return 'estado_invalido'; end if;

  -- Completude: conjunto de variacao_id de p_restaurar = item.variacao_ids, sem duplicata, não vazio.
  if jsonb_typeof(p_restaurar) = 'array' then
    select array_agg((e->>'variacao_id')::uuid) into v_ids from jsonb_array_elements(p_restaurar) e;
  end if;
  if coalesce(cardinality(v_ids), 0) = 0
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
     or not (v_ids @> coalesce(v_it.variacao_ids, '{}') and v_ids <@ coalesce(v_it.variacao_ids, '{}')) then
    v_conflito := 'Conjunto de variações do anúncio não confere com o preview — nada foi gravado no banco';
  else
    -- Fase 1: só leitura (com lock das linhas, em ordem de id).
    for v_e in select e from jsonb_array_elements(p_restaurar) e order by (e->>'variacao_id')::uuid loop
      select v.preco_publicacao, v.preco_editado_pelo_operador into v_pub, v_edit
      from public.variacoes v
      where v.org_id = p_org and v.id = (v_e->>'variacao_id')::uuid
      for update;
      if not found
         or v_pub is distinct from (v_e->'esperado'->>'preco_publicacao')::numeric
         or v_edit is distinct from (v_e->'esperado'->>'preco_editado_pelo_operador')::boolean then
        v_conflito := 'Conflito: o preço de uma cor foi alterado por outro fluxo durante o reajuste — ML ficou com o preço novo; o próximo UPDATE publicará o valor do banco';
        exit;
      end if;
    end loop;
  end if;

  if v_conflito is not null then
    update public.operacoes_massa_itens i
    set status = 'erro', etapa = null, atualizado_em = now(), mensagem = v_conflito
    where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
    return 'conflito';
  end if;

  -- Fase 2: escrita.
  for v_e in select e from jsonb_array_elements(p_restaurar) e loop
    update public.variacoes v
    set preco_publicacao = (v_e->'novo'->>'preco_publicacao')::numeric,
        preco_editado_pelo_operador = (v_e->'novo'->>'preco_editado_pelo_operador')::boolean,
        preco_publicado_ml = p_preco_confirmado
    where v.org_id = p_org and v.id = (v_e->>'variacao_id')::uuid;
  end loop;
  update public.operacoes_massa_itens i
  set status = 'aplicado', etapa = null, mensagem = p_mensagem, atualizado_em = now()
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
  return 'ok';
end;
$$;

revoke execute on function public.reajuste_persistir(uuid, uuid, text, uuid, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.reajuste_persistir(uuid, uuid, text, uuid, numeric, jsonb, text) to service_role;
