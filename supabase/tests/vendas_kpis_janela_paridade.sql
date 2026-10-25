\set ON_ERROR_STOP on
-- Paridade com dado real (read-only): vendas_kpis_janela × cache platform_org_month_metrics
-- (gravado por materializeMonth = calcularResumo), TODO mês fechado em cache (BRT), toda org com linha.
-- O plano pedia 2026-09, mas o cache em prod (24/10) só tem 2026-04..2026-08: compara-se o que existe.
-- Só compara cache fresco (mesmo count(*) e source_max_updated_at >= max(atualizado_em) do mês);
-- cache defasado é pulado com NOTICE. Qualquer divergência ao centavo aborta. Avil e DSA
-- (slugs 'avil' e 'diego-souza') têm de estar entre as comparadas.
--
-- Ticket: tolerância de R$ 0,01 (ADR-0190 D-2). A RPC arredonda em decimal exato half-up; o motor
-- (`calcularResumo`) faz round2 em float, cujo resultado no meio-centavo depende de artefato de float e
-- da ordem da soma (1,13 ÷ 2: motor 0,56, RPC 0,57). Faturamento e pedidos são exatos.
-- Faturamento: a RPC soma round(valor, 2) em numeric e o motor soma round2 em float; os dois só
-- concordam se valor/cupom têm até 2 casas — guarda abaixo prova isso para a tabela inteira.
begin;
do $$
declare
  c record;
  r json;
  fat numeric;
  ped int;
  comparados int := 0;
  pulados int := 0;
  ticket_1c int := 0;
  por_org jsonb := '{}';
  casas_extras int;
begin
  select count(*) into casas_extras from public.ml_vendas v
   where v.total_amount <> round(v.total_amount, 2) or v.cupom_vendedor <> round(v.cupom_vendedor, 2);
  if casas_extras > 0 then
    raise exception '% venda(s) com valor/cupom de mais de 2 casas: round numeric × float pode divergir', casas_extras;
  end if;

  for c in
    select m.org_id, o.slug, m.month, d.desde, d.ate, m.gross_cents, m.orders, m.ticket_cents,
           m.source_count, m.source_max_updated_at, s.n, s.max_upd
      from public.platform_org_month_metrics m
      join public.organizations o on o.id = m.org_id
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
      raise notice 'cache defasado, pulado: % mês % (cache %/% × vivo %/%)', c.slug, c.month, c.source_count, c.source_max_updated_at, c.n, c.max_upd;
      pulados := pulados + 1;
      continue;
    end if;
    r := public.vendas_kpis_janela(c.org_id, c.desde, c.ate);
    fat := (r->>'faturamento')::numeric;
    ped := (r->>'pedidos')::int;
    if round(fat * 100) <> c.gross_cents or ped <> c.orders
       or abs(round((r->>'ticket')::numeric * 100) - c.ticket_cents) > 1 then
      raise exception 'divergência % mês %: rpc % × cache gross_cents=% orders=% ticket_cents=%',
        c.slug, c.month, r, c.gross_cents, c.orders, c.ticket_cents;
    end if;
    if round((r->>'ticket')::numeric * 100) <> c.ticket_cents then ticket_1c := ticket_1c + 1; end if;
    comparados := comparados + 1;
    por_org := jsonb_set(por_org, array[c.slug], to_jsonb(coalesce((por_org->>c.slug)::int, 0) + 1));
  end loop;
  if not (por_org ? 'avil') or not (por_org ? 'diego-souza') then
    raise exception 'Avil e DSA têm de estar entre as comparadas: % (pulados=%)', por_org, pulados;
  end if;
  raise notice 'paridade meses em cache: comparados=% pulados=% ticket_dif_1c=% por org=%', comparados, pulados, ticket_1c, por_org;
end $$;
rollback;
