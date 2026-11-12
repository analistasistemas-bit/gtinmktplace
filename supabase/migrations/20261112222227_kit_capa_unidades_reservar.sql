-- ADR-0205 §8: teto de 6 tentativas por (org, base, n) a cada 24 h, ATÔMICO. A edge `gerar-capa-kit-unidades`
-- reserva a tentativa por esta RPC em vez de contar e inserir em passos separados (N pedidos paralelos com
-- request_id distintos liam o mesmo count e todos geravam).
-- Lock transacional sobre (org, base, n) → conta as linhas das últimas 24 h (qualquer status: pendente,
-- pendente_upload, gerada, recusada) → >= 6 devolve 'teto' sem inserir; senão insere a reserva `pendente` e devolve
-- 'ok'. Unique (org, request_id, tentativa) e o índice de tentativa viva continuam valendo: 23505 sobe para a edge
-- (o mesmo `em_andamento` de antes). Só service_role executa. Re-executável.

create or replace function public.kit_capa_unidades_reservar(
  p_org_id uuid, p_request_id uuid, p_tentativa smallint, p_familia_base_id uuid, p_n smallint, p_modelo text,
  p_criado_por uuid
) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'kit_capa_unidades:' || p_org_id::text || ':' || p_familia_base_id::text || ':' || p_n::text, 0));
  if (select count(*) from public.kit_variacao_imagens
      where org_id = p_org_id and familia_base_id = p_familia_base_id and n = p_n
        and criado_em >= pg_catalog.now() - interval '24 hours') >= 6 then
    return 'teto';
  end if;
  insert into public.kit_variacao_imagens
    (org_id, request_id, tentativa, status, familia_base_id, cores, rotulo, n, modelo, criado_por)
  values (p_org_id, p_request_id, p_tentativa, 'pendente', p_familia_base_id, null, null, p_n, p_modelo, p_criado_por);
  return 'ok';
end;
$$;
revoke all on function public.kit_capa_unidades_reservar(uuid, uuid, smallint, uuid, smallint, text, uuid) from public, anon, authenticated;
grant execute on function public.kit_capa_unidades_reservar(uuid, uuid, smallint, uuid, smallint, text, uuid) to service_role;
