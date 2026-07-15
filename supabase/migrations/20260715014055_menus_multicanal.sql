-- Menus multi-marketplace (spec 2026-07-14). Tudo aditivo e reversível.

-- D5: rollout por org — quais canais a empresa enxerga como conectáveis.
alter table organizations
  add column canais_habilitados text[] not null default '{mercado_livre}';

-- Dimensão canal nas vendas (preparação; hoje tudo é ML — nenhum número muda).
alter table ml_vendas
  add column canal text not null default 'mercado_livre';

-- Leitura estreita dos canais da própria org (evita abrir SELECT em organizations).
create or replace function public.canais_habilitados_da_org()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select canais_habilitados from public.organizations where id = public.current_org_id()
$$;
revoke all on function public.canais_habilitados_da_org() from public;
grant execute on function public.canais_habilitados_da_org() to authenticated;

-- Menu novo 'canais': quem tem 'configuracoes' ganha acesso (backfill idempotente).
update profiles
  set allowed_menus = array_append(allowed_menus, 'canais')
  where 'configuracoes' = any(allowed_menus)
    and not ('canais' = any(allowed_menus));
