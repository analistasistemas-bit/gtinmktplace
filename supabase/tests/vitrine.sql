\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('95000000-0000-0000-0000-000000000001', 'Vitrine test', 'vitrine-test'),
  ('95000000-0000-0000-0000-000000000002', 'Outra org vitrine', 'outra-org-vitrine');
insert into auth.users (id, email, raw_user_meta_data) values
  ('95000000-0000-0000-0000-000000000101', 'vitrine@test.local', '{"org_id":"95000000-0000-0000-0000-000000000001"}'::jsonb),
  ('95000000-0000-0000-0000-000000000102', 'outra-vitrine@test.local', '{"org_id":"95000000-0000-0000-0000-000000000002"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', true),
  ('95000000-0000-0000-0000-000000000102', '95000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

-- Visitas (período 01–04/09; anterior 28–31/08 sem linhas). 04/09 de MLBA1 sem linha de propósito.
insert into public.ml_item_visitas_dia (org_id, ml_item_id, dia, visitas, estado, coletado_em, rodada) values
  ('95000000-0000-0000-0000-000000000001', 'MLBA1', '2026-09-01', 100, 'ok', now(), now()),
  ('95000000-0000-0000-0000-000000000001', 'MLBA1', '2026-09-02', 50, 'pendente', now(), now()),
  ('95000000-0000-0000-0000-000000000001', 'MLBA1', '2026-09-03', 0, 'ok', now(), now()),
  ('95000000-0000-0000-0000-000000000001', 'MLBK1', '2026-09-01', 40, 'ok', now(), now()),
  ('95000000-0000-0000-0000-000000000002', 'MLBB1', '2026-09-01', 999, 'ok', now(), now());

-- Kit virtual: o ML emite UMA order por componente, ligadas pelo mesmo pack_id (A-5a/A-5b) → 1 pedido no MLBK1.
insert into public.ml_vendas (id, user_id, org_id, order_id, status, date_closed, kit_item_id, pack_id) values
  ('95000000-0000-0000-0000-00000000a001', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 9500001, 'paid', '2026-09-01 12:00-03', null, null),
  ('95000000-0000-0000-0000-00000000a002', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 9500002, 'paid', '2026-09-01 12:00-03', null, null),
  ('95000000-0000-0000-0000-00000000a003', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 9500003, 'paid', '2026-09-02 12:00-03', null, null),
  ('95000000-0000-0000-0000-00000000a004', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 9500004, 'cancelled', '2026-09-01 12:00-03', null, null),
  ('95000000-0000-0000-0000-00000000a05a', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 9500051, 'paid', '2026-09-01 12:00-03', 'MLBK1', 9500050),
  ('95000000-0000-0000-0000-00000000a05b', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 9500052, 'paid', '2026-09-01 12:00-03', 'MLBK1', 9500050);
insert into public.ml_vendas_itens (user_id, org_id, venda_id, ml_item_id, variation_id, quantity, unit_price) values
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-00000000a001', 'MLBA1', null, 1, 75),
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-00000000a002', 'MLBA1', null, 1, 75),
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-00000000a003', 'MLBA1', null, 1, 75),
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-00000000a004', 'MLBA1', null, 1, 75),
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-00000000a05a', 'MLBA1', null, 1, 30),
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-00000000a05b', 'MLBA1', null, 1, 30),
  -- adversarial: item de outra org pendurado na venda A-1 (variation_id diferente p/ não colidir no índice único)
  ('95000000-0000-0000-0000-000000000102', '95000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-00000000a001', 'MLBA1', 999, 5, 1000);

-- Vínculo: familias exige lote_id → codigo_pai coberto via anuncios_externos (prio 1 do info).
insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, item_externo_id, titulo) values
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 'mercado_livre', 'P-A', 'MLBA1', 'Anúncio A');
-- Título do kit vem de kits_virtuais (status 'publicando' dispensa o gatilho de componentes).
insert into public.kits_virtuais (org_id, chave_cadastro, ml_item_id, titulo, desconto_pct, status) values
  ('95000000-0000-0000-0000-000000000001', 'vitrine-teste', 'MLBK1', 'Kit virtual teste', 0.1, 'publicando');

-- Ads: status real em prod é maiúsculo; grupo PAUSED não conta.
insert into public.ml_ads_grupo (org_id, ad_group_id, tipo, status, atualizado_em) values
  ('95000000-0000-0000-0000-000000000001', 9501, 'ITEM', 'ACTIVE', now()),
  ('95000000-0000-0000-0000-000000000001', 9502, 'ITEM', 'PAUSED', now());
insert into public.ml_ads_grupo_item (org_id, ad_group_id, ml_item_id, visto_em) values
  ('95000000-0000-0000-0000-000000000001', 9501, 'MLBK1', now()),
  ('95000000-0000-0000-0000-000000000001', 9502, 'MLBA1', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"95000000-0000-0000-0000-000000000101","role":"authenticated"}';

do $$
declare r jsonb := public.vitrine_resumo('2026-09-01','2026-09-04');
        a jsonb; k jsonb;
begin
  select e into a from jsonb_array_elements(r->'itens') e where e->>'ml_item_id' = 'MLBA1';
  select e into k from jsonb_array_elements(r->'itens') e where e->>'ml_item_id' = 'MLBK1';
  -- IS DISTINCT FROM em tudo: campo ausente (NULL) tem que reprovar, não passar calado
  if a is null or k is null then raise exception 'MLBA1/MLBK1 ausentes %', r->'itens'; end if;
  if jsonb_array_length(r->'itens') is distinct from 2 then raise exception 'itens (vazou org B?) %', r->'itens'; end if;
  if (a->>'visitas')::int is distinct from 100 then raise exception 'A visitas %', a; end if;
  if (a->>'pedidos')::int is distinct from 2 then raise exception 'A pedidos (pendente/cancelada/kit não contam) %', a; end if;
  if (a->>'receita')::numeric is distinct from 150 then raise exception 'A receita (item de outra org?) %', a; end if;
  if (a->>'pares_ok')::int is distinct from 2 or (a->>'pares_total')::int is distinct from 4 then raise exception 'A pares (dia ausente) %', a; end if;
  if (a->>'pares_ok_ant')::int is distinct from 0 or (a->>'pares_total_ant')::int is distinct from 4 then raise exception 'A pares ant %', a; end if;
  if (k->>'pedidos')::int is distinct from 1 or (k->>'receita')::numeric is distinct from 60 then raise exception 'kit (1 pedido por pack) %', k; end if;
  if jsonb_array_length(r->'semanas') is distinct from 1
     or (r->'semanas'->0->>'pedidos')::int is distinct from 3
     or (r->'semanas'->0->>'pares_total')::int is distinct from 8
     or (r->'semanas'->0->>'pares_ok')::int is distinct from 3 then raise exception 'semanas %', r->'semanas'; end if;
  -- dow 2 (terça 01/09): pares_ok 2 (A1+K1), pares_total 2
  if (select (e->>'pares_ok')::int from jsonb_array_elements(r->'dias_semana') e where (e->>'dow')::int = 2) is distinct from 2
     or (select (e->>'pedidos')::int from jsonb_array_elements(r->'dias_semana') e where (e->>'dow')::int = 2) is distinct from 3
     then raise exception 'dias_semana %', r->'dias_semana'; end if;
  if a->>'codigo_pai' is distinct from 'P-A' then raise exception 'vínculo %', a; end if;
  if k->>'titulo' is distinct from 'Kit virtual teste' or k->>'codigo_pai' is not null then raise exception 'título do kit %', k; end if;
  if (k->>'em_ads')::boolean is distinct from true or (a->>'em_ads')::boolean is distinct from false
     then raise exception 'em_ads (ACTIVE maiúsculo; PAUSED fora) % %', k, a; end if;
  begin
    perform public.vitrine_resumo('2026-01-01','2026-12-31');
    raise exception 'não recusou período longo';
  exception when others then
    if sqlerrm not like 'vitrine_resumo: período inválido%' then raise; end if;
  end;
  raise notice 'TESTE_OK';
end $$;
rollback;
