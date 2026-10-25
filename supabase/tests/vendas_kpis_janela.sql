\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('96000000-0000-0000-0000-000000000001', 'KPIs janela test', 'kpis-janela-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('96000000-0000-0000-0000-000000000101', 'kpis-janela@test.local', '{"org_id":"96000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

-- (a) pack 9600010 em 01/09: 2 pagas (100 + 60 com cupom do vendedor 10) + 1 cancelada (fora).
-- (b) pack 9600020 em 02/09: a order de MENOR order_id está cancelada; a outra paga R$ 50 → conta.
-- Borda: paga com date_closed = p_ate (fora, janela aberta à direita).
insert into public.ml_vendas (id, user_id, org_id, order_id, pack_id, status, date_closed, total_amount, cupom_vendedor) values
  ('96000000-0000-0000-0000-00000000a011', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600011, 9600010, 'paid',      '2026-09-01 12:00-03', 100, null),
  ('96000000-0000-0000-0000-00000000a012', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600012, 9600010, 'paid',      '2026-09-01 12:00-03', 60, 10),
  ('96000000-0000-0000-0000-00000000a013', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600013, 9600010, 'cancelled', '2026-09-01 12:00-03', 999, null),
  ('96000000-0000-0000-0000-00000000a021', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600021, 9600020, 'cancelled', '2026-09-02 12:00-03', 70, null),
  ('96000000-0000-0000-0000-00000000a022', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600022, 9600020, 'paid',      '2026-09-02 12:00-03', 50, null),
  ('96000000-0000-0000-0000-00000000a031', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600031, null,    'paid',      '2026-09-03 00:00-03', 500, null),
  -- Regressões do ticket (meio-centavo, onde o round2 em float do motor erra): 05/09 e 06/09.
  ('96000000-0000-0000-0000-00000000a041', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600041, null,    'paid',      '2026-09-05 12:00-03', 1.00, null),
  ('96000000-0000-0000-0000-00000000a042', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600042, null,    'paid',      '2026-09-05 13:00-03', 0.13, null),
  ('96000000-0000-0000-0000-00000000a051', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600051, null,    'paid',      '2026-09-06 12:00-03', 1.01, null),
  ('96000000-0000-0000-0000-00000000a052', '96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', 9600052, null,    'paid',      '2026-09-06 13:00-03', 1.06, null);

do $$
declare
  r json;
  o constant uuid := '96000000-0000-0000-0000-000000000001';
begin
  -- (b) sozinho: 1 pedido, ticket = R$ 50 da order paga.
  r := public.vendas_kpis_janela(o, '2026-09-02 00:00-03', '2026-09-03 00:00-03');
  if (r->>'pedidos')::int <> 1 or (r->>'faturamento')::numeric <> 50 or (r->>'ticket')::numeric <> 50 then
    raise exception 'pack (b) errado: %', r;
  end if;
  -- Todo: 100 + 50 + 50 = 200; 2 pedidos; ticket 100.
  r := public.vendas_kpis_janela(o, '2026-09-01 00:00-03', '2026-09-03 00:00-03');
  if (r->>'pedidos')::int <> 2 or (r->>'faturamento')::numeric <> 200 or (r->>'ticket')::numeric <> 100 then
    raise exception 'todo errado: %', r;
  end if;
  -- Janela vazia: zeros, sem divisão por zero.
  r := public.vendas_kpis_janela(o, '2026-08-01 00:00-03', '2026-08-02 00:00-03');
  if (r->>'pedidos')::int <> 0 or (r->>'faturamento')::numeric <> 0 or (r->>'ticket')::numeric <> 0 then
    raise exception 'janela vazia errada: %', r;
  end if;
  -- Ticket decimal exato half-up: 1,00 + 0,13 em 2 pedidos → 0,57 (motor em float dá 0,56).
  r := public.vendas_kpis_janela(o, '2026-09-05 00:00-03', '2026-09-06 00:00-03');
  if (r->>'pedidos')::int <> 2 or (r->>'faturamento')::numeric <> 1.13 or (r->>'ticket')::numeric <> 0.57 then
    raise exception 'ticket 1,13/2 errado: %', r;
  end if;
  -- 1,01 + 1,06 em 2 pedidos → 1,04 (float por ordem de soma pode dar 1,03).
  r := public.vendas_kpis_janela(o, '2026-09-06 00:00-03', '2026-09-07 00:00-03');
  if (r->>'pedidos')::int <> 2 or (r->>'faturamento')::numeric <> 2.07 or (r->>'ticket')::numeric <> 1.04 then
    raise exception 'ticket 2,07/2 errado: %', r;
  end if;
  -- Grants: só service_role executa.
  if has_function_privilege('anon', 'public.vendas_kpis_janela(uuid, timestamptz, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.vendas_kpis_janela(uuid, timestamptz, timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.vendas_kpis_janela(uuid, timestamptz, timestamptz)', 'execute') then
    raise exception 'grants errados';
  end if;
end $$;
rollback;
