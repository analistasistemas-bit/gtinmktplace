-- ADR-0190 D-2: KPIs de venda (faturamento e pedidos) por janela para a notificação gerencial/comandos do Telegram.
-- Regras IGUAIS a `calcularResumo` (_shared/platform-admin/sales-summary.ts), para o número bater com a tela:
--   janela date_closed ∈ [p_desde, p_ate); faturável = paid/partially_refunded/refunded (STATUS_FATURAVEL);
--   faturamento = Σ round2(total_amount − cupom_vendedor) (brutoDaVenda, ADR-0180);
--   pedidos = carrinhos distintos (pack_id ?? order_id) entre as faturáveis (ADR-0039) — o carrinho
--   conta se QUALQUER membro é faturável. O ticket NÃO sai daqui: `lerKpis` (kpis.ts) aplica o round2
--   do motor em float — round(numeric, 2) diverge no meio-centavo (1,13 ÷ 2: motor 0,56, numeric 0,57).
-- Index scan em ml_vendas_org_data_idx (org_id, date_closed).
create or replace function public.vendas_kpis_janela(p_org uuid, p_desde timestamptz, p_ate timestamptz)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select
      coalesce(sum(round(coalesce(v.total_amount, 0) - coalesce(v.cupom_vendedor, 0), 2)), 0) as faturamento,
      count(distinct coalesce(v.pack_id, v.order_id))::int as pedidos
    from public.ml_vendas v
    where v.org_id = p_org
      and v.date_closed >= p_desde and v.date_closed < p_ate
      and v.status in ('paid', 'partially_refunded', 'refunded')
  )
  select json_build_object('faturamento', f.faturamento, 'pedidos', f.pedidos)
  from f
$$;

comment on function public.vendas_kpis_janela(uuid, timestamptz, timestamptz) is
  'ADR-0190 D-2: faturamento/pedidos de uma org em date_closed ∈ [p_desde, p_ate), regras de calcularResumo. Somente service_role.';

revoke all on function public.vendas_kpis_janela(uuid, timestamptz, timestamptz) from public;
revoke all on function public.vendas_kpis_janela(uuid, timestamptz, timestamptz) from anon;
revoke all on function public.vendas_kpis_janela(uuid, timestamptz, timestamptz) from authenticated;
grant execute on function public.vendas_kpis_janela(uuid, timestamptz, timestamptz) to service_role;
