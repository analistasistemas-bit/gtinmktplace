-- ADR-0133: severidade congelada no instante do evento. O `default 'info'` É o backfill dos
-- alertas históricos — classificá-los contra o preço de hoje contradiria o congelamento.
alter table public.pulse_alertas
  add column severidade text not null default 'info'
    check (severidade in ('acao','info'));

-- Badge e filtro sempre consultam org + severidade + não lido, ordenados por data.
create index pulse_alertas_org_sev_lido_idx
  on public.pulse_alertas (org_id, severidade, lido, criado_em desc);
