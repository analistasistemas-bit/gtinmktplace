-- ADR-0195 — Conferência pós-escrita no Mercado Livre: uma linha por família e item escrito.
-- O worker grava o valor enviado (depois do teto); `confirmar-publicacao-ml` relê o ML e fecha o status.
-- `enviado_em` é a versão da escrita: um upsert novo invalida os jobs da escrita anterior.

create table if not exists public.confirmacoes_ml (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  lote_id          uuid not null references public.lotes(id) on delete cascade,
  familia_id       uuid not null references public.familias(id) on delete cascade,
  codigo_pai       text not null,
  item_externo_id  text not null,
  modelo           text not null check (modelo in ('variacoes', 'item')),
  enviado          jsonb not null,               -- { sku: { qtd, anterior, variacao_id } }
  observado        jsonb,
  divergentes      jsonb not null default '[]',  -- [{ sku, enviado, observado }]
  capados          int not null default 0,
  status           text not null default 'aguardando'
                   check (status in ('aguardando', 'confirmado', 'inconclusivo', 'falhou')),
  tentativas       int not null default 0,
  enviado_em       timestamptz not null,
  verificado_em    timestamptz,
  unique (familia_id, item_externo_id)
);

create index if not exists confirmacoes_ml_lote_idx on public.confirmacoes_ml (lote_id);

alter table public.confirmacoes_ml enable row level security;
drop policy if exists "confirmacoes_ml: select org" on public.confirmacoes_ml;
create policy "confirmacoes_ml: select org" on public.confirmacoes_ml
  for select to authenticated using (org_id = (select public.current_org_id()));
-- Default privileges do Supabase dão ALL (inclui TRUNCATE, que RLS não cobre). Escrita só pela edge (service_role).
revoke all on public.confirmacoes_ml from anon, authenticated;
grant select on public.confirmacoes_ml to authenticated;
