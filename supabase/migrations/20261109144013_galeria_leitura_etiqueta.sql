-- Galeria da cor por IA (ADR-0201 §3, Task 6b): leitura da etiqueta por visão, uma vigente por
-- (org, anúncio, família). `chave` = campos + fotos usadas: mesma chave sem falha → nenhuma visão nova.
-- `leitura` guarda o valor lido por campo (a comparação com o cadastro é do código, refeita a cada montagem).
-- `parcial` = alguma foto ficou de fora (teto ou erro). Leitura pela org; escrita só service_role (edge galeria-fatos).
create table public.galeria_leituras_etiqueta (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  anuncio_externo_id uuid references public.anuncios_externos(id) on delete set null,
  familia_id uuid not null,
  chave text,
  leitura jsonb not null default '{}'::jsonb check (jsonb_typeof(leitura) = 'object'),
  falhou boolean not null default false,
  parcial boolean not null default false,
  -- Foto pulada por erro (URL/download): a leitura não é cache e a próxima montagem relê.
  pulou_por_erro boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (org_id, anuncio_externo_id, familia_id)
);

alter table public.galeria_leituras_etiqueta enable row level security;
revoke all on public.galeria_leituras_etiqueta from anon, authenticated;
grant select on public.galeria_leituras_etiqueta to authenticated;
create policy "galeria_leituras_etiqueta: select org" on public.galeria_leituras_etiqueta
  for select to authenticated using (org_id = (select public.current_org_id()));
