alter table public.pulse_ofertas
  add column if not exists full_ml boolean not null default false;

comment on column public.pulse_ofertas.full_ml is
  'shipping.logistic_type === fulfillment de /products/{id}/items — mesma leitura já usada em _shared/concorrencia/parse.ts para a Viabilidade. Alimenta full_relevantes na qualificação do Pulse.';

create or replace view public.pulse_ofertas_atual with (security_invoker = true) as
  select distinct on (produto_id, item_id)
    id, org_id, produto_id, item_id, seller_id, preco, tier, frete_gratis,
    loja_oficial, ativo, dia, permalink, visitas_30d, visitas_30d_em, full_ml
  from public.pulse_ofertas
  order by produto_id, item_id, dia desc;

grant select on public.pulse_ofertas_atual to authenticated;
