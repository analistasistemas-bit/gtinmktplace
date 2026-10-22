-- Extensão PubliAI v1 (ADR-0189 D-8/D-19): vínculo de produto da organização, contador diário de uso
-- e erros de leitura de página deduplicados. Nada de anúncio de concorrente além disso (D-1).
-- RLS: select da própria org; escrita só service_role (edge `extensao`), org_id explícito.

create table public.extensao_vinculos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  chave_tipo text not null check (chave_tipo in ('catalogo','item')),
  chave text not null,
  variacao_id uuid not null references public.variacoes(id) on delete cascade,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  unique (org_id, chave_tipo, chave)
);
create index extensao_vinculos_variacao_idx on public.extensao_vinculos (variacao_id);

create trigger extensao_vinculos_set_updated_at before update on public.extensao_vinculos
  for each row execute procedure extensions.moddatetime (atualizado_em);

create table public.extensao_uso_diario (
  org_id uuid not null references public.organizations(id),
  user_id uuid not null,
  dia date not null,
  tipo_pagina text not null check (tipo_pagina in ('anuncio','busca','catalogo')),
  analises int not null default 0,
  primary key (org_id, user_id, dia, tipo_pagina)
);

create table public.extensao_erros_leitura (
  org_id uuid not null references public.organizations(id),
  dia date not null,
  tipo_pagina text not null check (tipo_pagina in ('anuncio','busca','catalogo')),
  versao_extensao text not null,
  motivo text not null,
  ultimo_ml_item_id text,
  ocorrencias int not null default 1,
  atualizado_em timestamptz not null default now(),
  primary key (org_id, dia, tipo_pagina, versao_extensao, motivo)
);

-- RLS + grants — privilégio e policy são checagens independentes.
alter table public.extensao_vinculos      enable row level security;
alter table public.extensao_uso_diario    enable row level security;
alter table public.extensao_erros_leitura enable row level security;

create policy "extensao_vinculos: select org" on public.extensao_vinculos for select to authenticated
  using (org_id = (select public.current_org_id()));
create policy "extensao_uso_diario: select org" on public.extensao_uso_diario for select to authenticated
  using (org_id = (select public.current_org_id()));
create policy "extensao_erros_leitura: select org" on public.extensao_erros_leitura for select to authenticated
  using (org_id = (select public.current_org_id()));

revoke all on public.extensao_vinculos, public.extensao_uso_diario, public.extensao_erros_leitura from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.extensao_vinculos, public.extensao_uso_diario, public.extensao_erros_leitura from authenticated;
grant select on public.extensao_vinculos, public.extensao_uso_diario, public.extensao_erros_leitura to authenticated;
grant all on public.extensao_vinculos, public.extensao_uso_diario, public.extensao_erros_leitura to service_role;

-- Dia no fuso do operador (America/Sao_Paulo), como pulse_ofertas.dia.
create or replace function public.extensao_registrar_uso(p_org_id uuid, p_user_id uuid, p_tipo text)
returns void language sql security definer set search_path = public as $$
  insert into public.extensao_uso_diario as u (org_id, user_id, dia, tipo_pagina, analises)
  values (p_org_id, p_user_id, (now() at time zone 'America/Sao_Paulo')::date, p_tipo, 1)
  on conflict (org_id, user_id, dia, tipo_pagina) do update set analises = u.analises + 1;
$$;

create or replace function public.extensao_registrar_erro(
  p_org_id uuid, p_tipo text, p_versao text, p_motivo text, p_ml_item_id text)
returns void language sql security definer set search_path = public as $$
  insert into public.extensao_erros_leitura as e
    (org_id, dia, tipo_pagina, versao_extensao, motivo, ultimo_ml_item_id)
  values (p_org_id, (now() at time zone 'America/Sao_Paulo')::date, p_tipo, p_versao, p_motivo, p_ml_item_id)
  on conflict (org_id, dia, tipo_pagina, versao_extensao, motivo) do update
    set ocorrencias = e.ocorrencias + 1,
        ultimo_ml_item_id = coalesce(excluded.ultimo_ml_item_id, e.ultimo_ml_item_id),
        atualizado_em = now();
$$;

revoke all on function public.extensao_registrar_uso(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.extensao_registrar_uso(uuid, uuid, text) to service_role;
revoke all on function public.extensao_registrar_erro(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.extensao_registrar_erro(uuid, text, text, text, text) to service_role;
