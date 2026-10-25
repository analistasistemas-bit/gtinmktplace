\set ON_ERROR_STOP on
-- Paridade com dado real (read-only): vendas_kpis_janela × cache platform_org_month_metrics
-- (gravado por materializeMonth = calcularResumo), TODO mês fechado em cache (BRT), toda org com linha.
-- O plano pedia 2026-09, mas o cache em prod (24/10) só tem 2026-04..2026-08: compara-se o que existe.
-- Só compara cache fresco (mesmo count(*) e source_max_updated_at >= max(atualizado_em) do mês);
-- cache defasado é pulado com NOTICE. Qualquer divergência ao centavo aborta.
begin;
do $$
declare
  c record;
  r json;
  comparados int := 0;
  pulados int := 0;
begin
  for c in
    select m.org_id, m.month, d.desde, d.ate, m.gross_cents, m.orders, m.ticket_cents, m.source_count, m.source_max_updated_at,
           s.n, s.max_upd
      from public.platform_org_month_metrics m
      cross join lateral (
        select (m.month::text || 'T00:00:00-03:00')::timestamptz as desde,
               ((m.month + interval '1 month')::date::text || 'T00:00:00-03:00')::timestamptz as ate
      ) d
      cross join lateral (
        select count(*) as n, max(v.atualizado_em) as max_upd
          from public.ml_vendas v
         where v.org_id = m.org_id
           and v.date_closed >= d.desde and v.date_closed < d.ate
      ) s
     order by m.month, m.org_id
  loop
    if c.source_count <> c.n or (c.max_upd is not null and (c.source_max_updated_at is null or c.source_max_updated_at < c.max_upd)) then
      raise notice 'cache defasado, pulado: org % mês % (cache %/% × vivo %/%)', c.org_id, c.month, c.source_count, c.source_max_updated_at, c.n, c.max_upd;
      pulados := pulados + 1;
      continue;
    end if;
    r := public.vendas_kpis_janela(c.org_id, c.desde, c.ate);
    if round((r->>'faturamento')::numeric * 100) <> c.gross_cents
       or (r->>'pedidos')::int <> c.orders
       or round((r->>'ticket')::numeric * 100) <> c.ticket_cents then
      raise exception 'divergência org % mês %: rpc % × cache gross_cents=% orders=% ticket_cents=%',
        c.org_id, c.month, r, c.gross_cents, c.orders, c.ticket_cents;
    end if;
    comparados := comparados + 1;
  end loop;
  if comparados = 0 then
    raise exception 'nenhuma org comparada (pulados=%): paridade vazia não prova nada', pulados;
  end if;
  raise notice 'paridade meses em cache: comparados=% pulados=%', comparados, pulados;
end $$;
rollback;
