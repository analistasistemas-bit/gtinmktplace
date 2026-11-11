-- ADR-0201 (Galeria da cor por IA), Task 16: listagem da retenção (edge `galeria-retencao`, QStash 1×/dia).
-- Só lista: objetos do bucket `imagens` sob `<org>/galeria-ia/` com mais de 1 dia, depois do cursor
-- (`galeria_cursores`, ordem `created_at, id`). Quem decide e apaga é a edge, pela API do Storage (nunca `delete` aqui).
create or replace function public.galeria_retencao_listar(p_cursor_em timestamptz, p_cursor_id uuid, p_limite integer)
returns table (id uuid, name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.created_at
    from storage.objects o
   where o.bucket_id = 'imagens'
     and (storage.foldername(o.name))[2] = 'galeria-ia'
     and o.created_at < now() - interval '1 day'
     and (p_cursor_em is null or (o.created_at, o.id) > (p_cursor_em, p_cursor_id))
   order by o.created_at, o.id
   limit least(greatest(p_limite, 1), 1000);
$$;
revoke all on function public.galeria_retencao_listar(timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.galeria_retencao_listar(timestamptz, uuid, integer) to service_role;
