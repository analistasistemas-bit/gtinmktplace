\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('96000000-0000-0000-0000-000000000001', 'Ads test', 'ads-test'),
  ('96000000-0000-0000-0000-000000000002', 'Outra org ads', 'outra-org-ads');
insert into auth.users (id, email, raw_user_meta_data) values
  ('96000000-0000-0000-0000-000000000101', 'ads@test.local', '{"org_id":"96000000-0000-0000-0000-000000000001"}'::jsonb),
  ('96000000-0000-0000-0000-000000000102', 'outra-ads@test.local', '{"org_id":"96000000-0000-0000-0000-000000000002"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('96000000-0000-0000-0000-000000000101', '96000000-0000-0000-0000-000000000001', true),
  ('96000000-0000-0000-0000-000000000102', '96000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

insert into public.ml_ads_sync (org_id, estado, rodada, posse_ate, carga_inicial_ok, cobertura_desde) values
  ('96000000-0000-0000-0000-000000000001', 'ok', '2026-10-01 10:00+00', now() + interval '5 min', true, '2026-07-01'),
  ('96000000-0000-0000-0000-000000000002', 'ok', null, null, true, '2026-07-01');

-- Escrita como service_role (o papel real do worker), não como dono do banco.
set local role service_role;
do $$ begin
  if coalesce(public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-09-30 10:00+00', now(),
       '[{"dia":"2026-09-01","cost":1,"clicks":1,"prints":1,"direct_amount":1,"indirect_amount":0,"total_amount":1}]'), true)
     then raise exception 'gravou com rodada que não é dona'; end if;
  if public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-10-01 10:00+00', '2026-10-02 12:00+00',
       '[{"dia":"2026-09-01","cost":100,"clicks":10,"prints":1000,"direct_amount":800,"indirect_amount":200,"total_amount":1000},
         {"dia":"2026-09-02","cost":50,"clicks":5,"prints":500,"direct_amount":0,"indirect_amount":0,"total_amount":0}]')
     is distinct from true then raise exception 'não gravou com a rodada dona'; end if;
  if (select conta_cobertura_desde from public.ml_ads_sync where org_id = '96000000-0000-0000-0000-000000000001')
     is distinct from '2026-09-01'::date then raise exception 'conta_cobertura_desde'; end if;
  perform public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-10-01 10:00+00', '2026-10-01 12:00+00',
       '[{"dia":"2026-09-01","cost":1,"clicks":0,"prints":0,"direct_amount":0,"indirect_amount":0,"total_amount":0}]');
  if (select cost from public.ml_ads_conta_dia where org_id = '96000000-0000-0000-0000-000000000001' and dia = '2026-09-01')
     is distinct from 100::numeric then raise exception 'coleta antiga sobrescreveu'; end if;
end $$;
reset role;

-- Outra org com o MESMO ad_group_id e membro próprio: nada dela pode vazar nas subconsultas.
insert into public.ml_ads_conta_dia (org_id, dia, cost, clicks, prints, direct_amount, indirect_amount, total_amount, coletado_em) values
  ('96000000-0000-0000-0000-000000000002', '2026-09-01', 999, 0, 0, 0, 0, 0, now());
insert into public.ml_ads_grupo (org_id, ad_group_id, tipo, status, atualizado_em) values
  ('96000000-0000-0000-0000-000000000001', 9601, 'FAMILY', 'ACTIVE', now()),
  ('96000000-0000-0000-0000-000000000001', 9602, 'FAMILY', 'PAUSED', now()),   -- sem membro
  ('96000000-0000-0000-0000-000000000001', 9603, 'ITEM', 'ACTIVE', now()),     -- gasto só fora do período
  ('96000000-0000-0000-0000-000000000002', 9601, 'FAMILY', 'ACTIVE', now()),
  ('96000000-0000-0000-0000-000000000002', 9602, 'FAMILY', 'ACTIVE', now());   -- antes dos membros (FK)
insert into public.ml_ads_grupo_item (org_id, ad_group_id, ml_item_id, visto_em) values
  ('96000000-0000-0000-0000-000000000001', 9601, 'MLB1', now()),
  ('96000000-0000-0000-0000-000000000001', 9601, 'MLB2', now()),
  ('96000000-0000-0000-0000-000000000002', 9601, 'MLB9', now()),
  ('96000000-0000-0000-0000-000000000002', 9602, 'MLB8', now());
insert into public.ml_ads_grupo_dia (org_id, ad_group_id, dia, cost, clicks, prints, direct_amount, indirect_amount, total_amount, direct_units, units, coletado_em) values
  ('96000000-0000-0000-0000-000000000001', 9601, '2026-09-01', 90, 9, 900, 800, 100, 900, 3, 4, now()),
  ('96000000-0000-0000-0000-000000000001', 9601, '2026-09-02', 40, 4, 400, 0, 0, 0, 0, 0, now()),
  ('96000000-0000-0000-0000-000000000001', 9602, '2026-09-01', 10, 1, 100, 0, 0, 0, 0, 0, now()),
  ('96000000-0000-0000-0000-000000000001', 9603, '2026-08-01', 7, 1, 1, 0, 0, 0, 0, 0, now()),
  ('96000000-0000-0000-0000-000000000002', 9601, '2026-09-01', 500, 0, 0, 0, 0, 0, 0, 0, now()),
  ('96000000-0000-0000-0000-000000000002', 9602, '2026-09-01', 300, 0, 0, 0, 0, 0, 0, 0, now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"96000000-0000-0000-0000-000000000101","role":"authenticated"}';

do $$
declare r jsonb := public.ads_painel('2026-09-01', '2026-09-02');
        s jsonb := public.ads_resumo_periodo('2026-09-01', '2026-09-02');
        g jsonb;
begin
  if r ? 'sync' is distinct from true or r ? 'conta' is distinct from true or r ? 'grupos' is distinct from true
     then raise exception 'chaves ausentes %', r; end if;
  if jsonb_array_length(r->'conta') is distinct from 2 then raise exception 'conta: só os 2 dias da própria org %', r->'conta'; end if;
  if (select sum((e->>'cost')::numeric) from jsonb_array_elements(r->'conta') e) is distinct from 150::numeric
     then raise exception 'conta: soma (vazou a outra org?) %', r->'conta'; end if;
  if (r->'sync'->>'conta_cobertura_desde') is distinct from '2026-09-01' then raise exception 'sync %', r->'sync'; end if;
  if jsonb_array_length(r->'grupos') is distinct from 2 then raise exception 'grupos com gasto no período (9601, 9602) %', r->'grupos'; end if;
  select e into g from jsonb_array_elements(r->'grupos') e where (e->>'ad_group_id')::bigint = 9601;
  if g is null then raise exception 'grupo 9601 ausente'; end if;
  if (g->>'cost')::numeric is distinct from 130::numeric or (g->>'total_amount')::numeric is distinct from 900::numeric
     or (g->>'direct_amount')::numeric is distinct from 800::numeric
     then raise exception 'soma do grupo 9601 (vazou o 9601 da outra org?) %', g; end if;
  if g->'membros' is distinct from '["MLB1","MLB2"]'::jsonb then raise exception 'membros (MLB9 é da outra org) %', g; end if;
  select e into g from jsonb_array_elements(r->'grupos') e where (e->>'ad_group_id')::bigint = 9602;
  if g is null or g->'membros' is distinct from '[]'::jsonb then raise exception 'grupo sem membro (MLB8 é da outra org) %', g; end if;
  if (s->>'custo_conta')::numeric is distinct from 150::numeric or (s->>'dias_conta')::int is distinct from 2
     or (s->>'custo_grupos_com_membro')::numeric is distinct from 130::numeric
     then raise exception 'resumo %', s; end if;
  -- limites: 90 dias inclusivos passam; 91 não; nulo/invertido não
  perform public.ads_painel('2026-07-05', '2026-10-02');
  begin perform public.ads_painel('2026-07-04', '2026-10-02'); raise exception 'aceitou 91 dias';
  exception when others then if sqlerrm not like 'ads_painel: período inválido%' then raise; end if; end;
  begin perform public.ads_painel('2026-09-02', '2026-09-01'); raise exception 'aceitou período invertido';
  exception when others then if sqlerrm not like 'ads_painel: período inválido%' then raise; end if; end;
  begin perform public.ads_painel(null, '2026-09-01'); raise exception 'painel aceitou nulo';
  exception when others then if sqlerrm not like 'ads_painel: período inválido%' then raise; end if; end;
  -- resumo: 366 dias inclusivos passam; 367 não; nulo/invertido não
  perform public.ads_resumo_periodo('2025-09-02', '2026-09-02');
  begin perform public.ads_resumo_periodo('2025-09-01', '2026-09-02'); raise exception 'resumo aceitou 367 dias';
  exception when others then if sqlerrm not like 'ads_resumo_periodo: período inválido%' then raise; end if; end;
  begin perform public.ads_resumo_periodo(null, '2026-09-01'); raise exception 'aceitou nulo';
  exception when others then if sqlerrm not like 'ads_resumo_periodo: período inválido%' then raise; end if; end;
  begin perform public.ads_resumo_periodo('2026-09-02', '2026-09-01'); raise exception 'resumo aceitou invertido';
  exception when others then if sqlerrm not like 'ads_resumo_periodo: período inválido%' then raise; end if; end;
  begin
    perform public.gravar_ads_conta_dias('96000000-0000-0000-0000-000000000001', '2026-10-01 10:00+00', now(), '[]');
    raise exception 'authenticated executou RPC de escrita';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.ml_ads_conta_dia where org_id = '96000000-0000-0000-0000-000000000002')
     then raise exception 'RLS: viu a conta de outra org'; end if;
end $$;

-- Sentido inverso: a outra org não vê a primeira.
set local request.jwt.claims = '{"sub":"96000000-0000-0000-0000-000000000102","role":"authenticated"}';
do $$
declare r jsonb := public.ads_painel('2026-09-01', '2026-09-02');
begin
  if (select sum((e->>'cost')::numeric) from jsonb_array_elements(r->'conta') e) is distinct from 999::numeric
     then raise exception 'org 2: conta %', r->'conta'; end if;
  if (select string_agg(e->>'ad_group_id', ',' order by e->>'ad_group_id') from jsonb_array_elements(r->'grupos') e)
     is distinct from '9601,9602' then raise exception 'org 2: grupos %', r->'grupos'; end if;
  if r->'grupos'->0->'membros' is distinct from '["MLB9"]'::jsonb then raise exception 'org 2: membros %', r->'grupos'; end if;
  raise notice 'TESTE_OK';
end $$;
rollback;
