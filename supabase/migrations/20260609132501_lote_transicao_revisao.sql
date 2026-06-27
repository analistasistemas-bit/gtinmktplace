-- Transição de lote 'processando' -> 'revisao' quando todas as famílias terminam a IA.
--
-- Lacuna do lifecycle (ADR-0005): `process-familia` marca a família como 'pronto'
-- mas nada flipava o status do LOTE, que ficava preso em 'processando' para sempre
-- (o KPI "A revisar" do Dashboard, que conta lotes em 'revisao', mostrava 0).
-- O único set de 'revisao' existente era pós-publicação (publish/update-familia-ml).
--
-- Feito no trigger (não no edge) para ser atômico contra a corrida do QStash:
-- várias famílias processam em paralelo; a última a terminar é a única que satisfaz
-- o NOT EXISTS, e o guard `status = 'processando'` torna o UPDATE idempotente (não
-- toca lotes em 'publicando'/'revisao'/'concluido').

create or replace function public.update_lote_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    update public.lotes l
       set total_familias   = (select count(*) from public.familias where lote_id = l.id),
           total_publicadas = (select count(*) from public.familias where lote_id = l.id and status = 'publicado'),
           total_erros      = (select count(*) from public.familias where lote_id = l.id and status = 'erro')
     where l.id = coalesce(new.lote_id, old.lote_id);

    update public.lotes l
       set status = 'revisao'
     where l.id = coalesce(new.lote_id, old.lote_id)
       and l.status = 'processando'
       and not exists (
         select 1 from public.familias f
         where f.lote_id = l.id and f.status in ('pendente', 'processando')
       );
  end if;
  return new;
end;
$$;

revoke execute on function public.update_lote_counters() from public, anon, authenticated;
