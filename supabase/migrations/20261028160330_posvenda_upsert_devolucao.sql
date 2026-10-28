-- ADR-0192: upsert de ml_devolucoes com guarda de versão. Snapshot lido do ML mais antigo
-- (lido_em menor) nunca sobrescreve um mais novo — webhook e reconciliar correm em paralelo.
-- Só as chaves presentes em `linha` são gravadas (coluna não lida fica como está).
-- SECURITY INVOKER + execute só para service_role (as edges).

create or replace function public.upsert_ml_devolucao(linha jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  cols text;
  sets text;
  r jsonb;
begin
  if linha is null or not (linha ? 'user_id') or not (linha ? 'claim_id') then
    raise exception 'upsert_ml_devolucao: user_id e claim_id são obrigatórios';
  end if;

  select string_agg(quote_ident(k), ', '),
         string_agg(format('%1$I = excluded.%1$I', k), ', ')
           filter (where k not in ('id', 'user_id', 'claim_id', 'criado_em'))
    into cols, sets
    from jsonb_object_keys(linha) as k;

  execute format(
    'insert into public.ml_devolucoes as t (%1$s)
       select %1$s from jsonb_populate_record(null::public.ml_devolucoes, $1)
     on conflict (user_id, claim_id) do update set %2$s
       where t.lido_em is null or excluded.lido_em >= t.lido_em
     returning to_jsonb(t.*)', cols, coalesce(sets, 'user_id = excluded.user_id'))
  into r using linha;

  -- Guarda barrou o update: devolve a linha que ficou.
  if r is null then
    select to_jsonb(d.*) into r from public.ml_devolucoes d
     where d.user_id = (linha->>'user_id')::uuid and d.claim_id = (linha->>'claim_id')::bigint;
  end if;
  return r;
end;
$$;

revoke all on function public.upsert_ml_devolucao(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_ml_devolucao(jsonb) to service_role;
