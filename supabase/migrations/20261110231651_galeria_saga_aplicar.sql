-- ADR-0201 (Galeria da cor), Task 14: saga de aplicar e reverter.
-- 1. galeria_concluir_item: o aborto da ida passa a gravar, na mesma transação, abortar_em e pendente|subindo →
--    pulado (esses estados nunca fizeram PUT; a posse de quem estiver subindo é anulada, então a gravação tardia dele
--    não pega). Também aborta quando o worker fecha o portão de avanço (roteiro/fatos trocados) e manda
--    p_dados.abortar = true. Resto idêntico à versão de 20261109093335.
-- 2. galeria_assumir_item: claim atômico de item de aplicação — fase da mensagem, lease livre, item aberto e a
--    aplicação em execução DENTRO do ciclo (ciclo_ate > now()) no mesmo update (Global Constraints "Claim").

create or replace function public.galeria_concluir_item(p_item uuid, p_posse uuid, p_status text, p_dados jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_apl uuid;
  v_status text;
begin
  if p_status is null or p_status not in ('aplicado', 'falhou', 'pulado', 'compensado', 'reversao_incompleta') then
    raise exception 'galeria_concluir_item: status inválido' using errcode = '22023';
  end if;
  select i.aplicacao_id into v_apl from public.galeria_aplicacao_itens i where i.id = p_item;
  if not found then
    raise exception 'item_inexistente' using errcode = 'P0002';
  end if;
  select a.status into v_status from public.galeria_aplicacoes a where a.id = v_apl for update;
  update public.galeria_aplicacao_itens i set
    status = p_status,
    fotos_depois = case when coalesce(p_dados, '{}'::jsonb) ? 'fotos_depois' then p_dados->'fotos_depois' else i.fotos_depois end,
    erro = case when coalesce(p_dados, '{}'::jsonb) ? 'erro' then p_dados->>'erro' else i.erro end,
    posse = null, lease_ate = null, publicado_em = null, atualizado_em = now()
   where i.id = p_item and i.posse = p_posse;
  if not found then
    return v_status;   -- posse perdida: nada gravado
  end if;
  if v_status = 'em_andamento'
    and (p_status in ('falhou', 'reversao_incompleta') or coalesce((p_dados->>'abortar')::boolean, false)) then
    update public.galeria_aplicacoes a set status = 'abortando', abortar_em = coalesce(a.abortar_em, now()),
      atualizado_em = now()
     where a.id = v_apl;
    update public.galeria_aplicacao_itens i set status = 'pulado', erro = coalesce(i.erro, 'abortada'),
      posse = null, lease_ate = null, publicado_em = null, atualizado_em = now()
     where i.aplicacao_id = v_apl and i.status in ('pendente', 'subindo');
    update public.galeria_aplicacao_itens i set status = 'compensando', compensar_ate = now() + interval '60 minutes',
      publicado_em = null, atualizado_em = now()
     where i.aplicacao_id = v_apl and i.status = 'aplicado';
  end if;
  return public.galeria_agregar_aplicacao(v_apl);
end;
$$;

create function public.galeria_assumir_item(p_item uuid, p_fase integer, p_posse uuid, p_lease_seg integer)
returns setof public.galeria_aplicacao_itens language sql security definer set search_path = '' as $$
  update public.galeria_aplicacao_itens i set posse = p_posse, lease_ate = now() + make_interval(secs => p_lease_seg),
    atualizado_em = now()
   where i.id = p_item and i.fase = p_fase
     and i.status in ('pendente', 'subindo', 'aplicando', 'compensando')
     and (i.lease_ate is null or i.lease_ate < now())
     and exists (select 1 from public.galeria_aplicacoes a
                  where a.id = i.aplicacao_id and a.status in ('em_andamento', 'abortando', 'revertendo')
                    and a.ciclo_ate > now() and a.anuncio_externo_id is not null)
  returning i.*
$$;

revoke all on function public.galeria_concluir_item(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.galeria_assumir_item(uuid, integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.galeria_concluir_item(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.galeria_assumir_item(uuid, integer, uuid, integer) to service_role;
