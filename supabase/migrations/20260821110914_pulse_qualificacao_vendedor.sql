alter table public.pulse_vendedores
  add column if not exists reputacao_detalhe jsonb,
  add column if not exists perfil_coletado_em timestamptz;

alter table public.pulse_ofertas
  add column if not exists visitas_30d_em timestamptz;

comment on column public.pulse_vendedores.reputacao_detalhe is
  'Perfil público normalizado do vendedor: período/transações, avaliações e métricas do ML.';
comment on column public.pulse_vendedores.perfil_coletado_em is
  'Instante exato da leitura de /users/{seller_id}; null = snapshot legado.';
comment on column public.pulse_ofertas.visitas_30d_em is
  'Instante da leitura de visitas 30d; null = nunca medido ou snapshot legado.';

create or replace view public.pulse_ofertas_atual with (security_invoker = true) as
  select distinct on (produto_id, item_id)
    id, org_id, produto_id, item_id, seller_id, preco, tier, frete_gratis,
    loja_oficial, ativo, dia, permalink, visitas_30d, visitas_30d_em
  from public.pulse_ofertas
  order by produto_id, item_id, dia desc;

grant select on public.pulse_ofertas_atual to authenticated;
