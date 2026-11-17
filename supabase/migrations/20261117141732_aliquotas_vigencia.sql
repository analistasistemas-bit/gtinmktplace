-- ============================================================================
-- Migration: aliquotas_vigencia
-- Refs: ADR-0208 (alíquota de imposto com vigência — mudança vale só daqui pra frente).
-- Cada mudança das 4 colunas de alíquota em `configuracoes` grava uma linha de vigência.
-- O imposto de uma venda passa a usar a vigência em vigor na data dela (tasks seguintes).
-- Aqui: tabela + RLS (só leitura) + trigger + backfill. Nada no app muda ainda.
-- ============================================================================

-- 1) Tabela. `on delete cascade`: a vigência pertence à org (mesmo padrão de configuracoes).
create table public.aliquotas_vigencia (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  vigente_desde  timestamptz not null,
  nacional_pct   numeric not null,
  importado_pct  numeric not null,
  uf_empresa     text,
  interna_pct    numeric,
  criado_em      timestamptz default now(),
  constraint aliquotas_vigencia_org_desde_key unique (org_id, vigente_desde)
);

create index aliquotas_vigencia_org_desde_idx
  on public.aliquotas_vigencia (org_id, vigente_desde desc);

-- 2) RLS: só SELECT, igual à policy de leitura de `configuracoes`. Só o trigger escreve.
--    O revoke cobre TRUNCATE, que ignora RLS.
alter table public.aliquotas_vigencia enable row level security;

create policy "aliquotas_vigencia: select org"
  on public.aliquotas_vigencia for select to authenticated
  using (org_id = (select public.current_org_id()));

revoke all on public.aliquotas_vigencia from anon, authenticated;
grant select on public.aliquotas_vigencia to authenticated;

-- 3) Função do trigger (security definer p/ contornar a falta de INSERT; padrão E7).
--    O seed (`trg_seed_configuracoes_org`) cria a linha 8/16 com aliquotas_confirmadas_em NULL:
--    ela NÃO vira vigência. Grava quando há confirmação e (INSERT | primeira confirmação, mesmo que
--    continue 8/16 | mudança de qualquer das 4 colunas).
create or replace function public.registrar_vigencia_aliquota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.aliquotas_confirmadas_em is null
     or new.aliquota_nacional_pct is null
     or new.aliquota_importado_pct is null then
    return new;
  end if;

  if tg_op = 'INSERT'
     or old.aliquotas_confirmadas_em is null
     or (new.aliquota_nacional_pct, new.aliquota_importado_pct, new.uf_empresa, new.aliquota_interna_pct)
        is distinct from
        (old.aliquota_nacional_pct, old.aliquota_importado_pct, old.uf_empresa, old.aliquota_interna_pct)
  then
    -- clock_timestamp() (não now()): avaliado no AFTER trigger, depois do lock da linha de
    -- configuracoes, então segue a ordem real dos saves concorrentes da mesma org.
    -- O `do update` só ocorre com dois saves no mesmo milissegundo: vale o último.
    insert into public.aliquotas_vigencia
      (org_id, vigente_desde, nacional_pct, importado_pct, uf_empresa, interna_pct)
    values
      (new.org_id, date_trunc('milliseconds', clock_timestamp()),
       new.aliquota_nacional_pct, new.aliquota_importado_pct, new.uf_empresa, new.aliquota_interna_pct)
    on conflict (org_id, vigente_desde) do update set
      nacional_pct  = excluded.nacional_pct,
      importado_pct = excluded.importado_pct,
      uf_empresa    = excluded.uf_empresa,
      interna_pct   = excluded.interna_pct;
  end if;

  return new;
end;
$$;

revoke all on function public.registrar_vigencia_aliquota() from public, anon, authenticated;

-- 4) Trigger.
drop trigger if exists trg_configuracoes_vigencia_aliquota on public.configuracoes;
create trigger trg_configuracoes_vigencia_aliquota
  after insert or update on public.configuracoes
  for each row execute function public.registrar_vigencia_aliquota();

-- 5) Pré-condição: cada org confirmada medida em produção (17/11/2026, somente leitura) tem que
--    estar exatamente como medido. Se divergir, aborta: os literais do backfill (6) ficariam errados.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('a72ea303-5559-4a35-9aff-daa12cd1de12'::uuid, 'Avil',               8.00::numeric, 16.00::numeric, 'PE', 1::numeric),
      ('3e2989f8-00cd-40ae-a34b-9c31107cea9b'::uuid, 'Daludi Shop',        6.50::numeric,  0.00::numeric, 'PE', 6.5::numeric),
      ('a1fcd536-bb43-4fae-9f44-1e09d19e6c8e'::uuid, 'DSA',                4.00::numeric,  0.00::numeric, 'PE', 4::numeric),
      ('383636a4-1db6-4ccb-a84b-ee091a436769'::uuid, 'Hairflay',           4.00::numeric,  0.00::numeric, 'PE', 1::numeric),
      ('23cd3929-418f-4408-adb2-55655e0628c5'::uuid, 'Hairfly Cosmeticos', 4.00::numeric,  0.00::numeric, 'PE', 1::numeric),
      ('b95a1c97-8477-4e3a-89b8-04f735549072'::uuid, 'Zaven',              4.00::numeric,  0.00::numeric, 'PE', 4::numeric)
    ) as v(org_id, nome, nacional, importado, uf, interna)
  loop
    if not exists (
      select 1 from public.configuracoes c
      where c.org_id = r.org_id
        and c.aliquotas_confirmadas_em is not null
        and c.aliquota_nacional_pct  = r.nacional
        and c.aliquota_importado_pct = r.importado
        and c.uf_empresa is not distinct from r.uf
        and c.aliquota_interna_pct is not distinct from r.interna
    ) then
      raise exception 'ADR-0208: config da org % (%) divergiu do medido', r.nome, r.org_id;
    end if;
  end loop;
end $$;

-- 6) Backfill com valores FIXOS (não lidos na hora). Idempotente.
--    Toda org medida: 1970-01-01 com os valores atuais. Exceto a Daludi (abaixo).
insert into public.aliquotas_vigencia (org_id, vigente_desde, nacional_pct, importado_pct, uf_empresa, interna_pct)
values
  ('a72ea303-5559-4a35-9aff-daa12cd1de12', '1970-01-01T00:00:00Z', 8.00, 16.00, 'PE', 1),  -- Avil
  ('a1fcd536-bb43-4fae-9f44-1e09d19e6c8e', '1970-01-01T00:00:00Z', 4.00,  0.00, 'PE', 4),  -- DSA
  ('383636a4-1db6-4ccb-a84b-ee091a436769', '1970-01-01T00:00:00Z', 4.00,  0.00, 'PE', 1),  -- Hairflay
  ('23cd3929-418f-4408-adb2-55655e0628c5', '1970-01-01T00:00:00Z', 4.00,  0.00, 'PE', 1),  -- Hairfly Cosmeticos
  ('b95a1c97-8477-4e3a-89b8-04f735549072', '1970-01-01T00:00:00Z', 4.00,  0.00, 'PE', 4)   -- Zaven
on conflict (org_id, vigente_desde) do nothing;

-- Daludi Shop: 4% até 17/11/2026 09:40 BRT (confirmado pelo Diego); 6,5% desde então.
insert into public.aliquotas_vigencia (org_id, vigente_desde, nacional_pct, importado_pct, uf_empresa, interna_pct)
values
  ('3e2989f8-00cd-40ae-a34b-9c31107cea9b', '1970-01-01T00:00:00Z', 4.00, 0.00, 'PE', 4),
  ('3e2989f8-00cd-40ae-a34b-9c31107cea9b', '2026-11-17T12:40:00Z', 6.50, 0.00, 'PE', 6.5)
on conflict (org_id, vigente_desde) do nothing;
