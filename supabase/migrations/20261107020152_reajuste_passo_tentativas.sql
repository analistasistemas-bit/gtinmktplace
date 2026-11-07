-- ADR-0196 — cada escrita pedida conta em `tentativas` do passo: escrita aceita que nunca pega para de repetir e a reserva
-- é solta. Contar aqui, antes da escrita, vale também para o worker que morre depois dela.
create or replace function public.reajuste_passo_marcar(p_org uuid, p_operacao uuid, p_ml_item text, p_token uuid,
                                             p_indice integer, p_estado text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_it public.operacoes_massa_itens%rowtype;
begin
  select * into v_it from public.operacoes_massa_itens i
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item
  for update;
  if not found or v_it.status <> 'enviando' or not coalesce(v_it.lease_token = p_token, false) then
    return false;
  end if;

  -- `null not in (...)` é null e passaria; to_jsonb(null) faria o jsonb_set apagar `passos`.
  if p_estado is null or p_estado not in ('pendente','escrita_pedida','confirmado','volta_pendente','volta_pedida','compensado') then
    raise exception 'reajuste_passo_marcar: estado desconhecido: %', p_estado;
  end if;
  if p_indice is null or p_indice < 0 or p_indice >= coalesce(jsonb_array_length(v_it.passos), 0) then
    raise exception 'reajuste_passo_marcar: passo % não existe em %', p_indice, p_ml_item;
  end if;
  -- Item com passo em estado de volta nunca retoma a ida.
  if p_estado in ('pendente','escrita_pedida','confirmado') and exists (
       select 1 from jsonb_array_elements(v_it.passos) p
       where p->>'estado' in ('volta_pendente','volta_pedida','compensado')) then
    raise exception 'reajuste_passo_marcar: % em compensação não retoma a ida', p_ml_item;
  end if;

  update public.operacoes_massa_itens i
  set passos = jsonb_set(
        case when p_estado = 'escrita_pedida'
             then jsonb_set(i.passos, array[p_indice::text, 'tentativas'],
                            to_jsonb(coalesce((i.passos->p_indice->>'tentativas')::integer, 0) + 1))
             else i.passos end,
        array[p_indice::text, 'estado'], to_jsonb(p_estado)),
      etapa = case when p_estado in ('escrita_pedida','volta_pedida') then 'escrita_pedida' else i.etapa end,
      lease_ate = now() + interval '2 minutes', atualizado_em = now()
  where i.org_id = p_org and i.operacao_id = p_operacao and i.ml_item_id = p_ml_item;
  return true;
end;
$$;
