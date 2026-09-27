\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('95000000-0000-0000-0000-000000000001', 'Ads test', 'ads-test'),
  ('95000000-0000-0000-0000-000000000002', 'Outra org ads', 'outra-org-ads');
insert into auth.users (id, email, raw_user_meta_data) values
  ('95000000-0000-0000-0000-000000000101', 'ads@test.local', '{"org_id":"95000000-0000-0000-0000-000000000001"}'::jsonb),
  ('95000000-0000-0000-0000-000000000102', 'outra-ads@test.local', '{"org_id":"95000000-0000-0000-0000-000000000002"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', true),
  ('95000000-0000-0000-0000-000000000102', '95000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
-- Mapa MLB → código (mesmas fontes de vendas_sku_mlbs): MLB1 legado multi-cor (A, B), MLB2 filho UP (A).
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai, item_externo_id, variacoes_externas, ml_item_id_anterior, migracao_pxv_snapshot) values
  ('95000000-0000-0000-0000-000000000601', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 'mercado_livre', '09500000', 'MLB1', '{"A":{},"B":{}}'::jsonb, null, null),
  ('95000000-0000-0000-0000-000000000602', '95000000-0000-0000-0000-000000000102', '95000000-0000-0000-0000-000000000002', 'mercado_livre', '09500000', 'MLB1', '{"Z":{}}'::jsonb, null, null);
insert into public.anuncios_externos_itens (anuncio_externo_id, org_id, sku, status, item_externo_id) values
  ('95000000-0000-0000-0000-000000000601', '95000000-0000-0000-0000-000000000001', 'A', 'ativo', 'MLB2');

-- Grants: escrita só service_role; leitura do mapa só authenticated.
do $$
declare f text;
begin
  foreach f in array array[
    'public.reservar_ads_posse(uuid)', 'public.avancar_ads_cursor(uuid,timestamptz,text,text)',
    'public.gravar_ads_lote(uuid,timestamptz,timestamptz,jsonb)',
    'public.concluir_ads_rodada(uuid,timestamptz,text,text,boolean,bigint,date,numeric,numeric)',
    'public.limpar_ads_retencao(date)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('public', f, 'execute') then raise exception 'RPC exposta: %', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'service_role sem execute: %', f; end if;
  end loop;
  if has_function_privilege('anon', 'public.vendas_sku_codigos_mlbs(text[])', 'execute')
     or not has_function_privilege('authenticated', 'public.vendas_sku_codigos_mlbs(text[])', 'execute')
    then raise exception 'grants de vendas_sku_codigos_mlbs errados'; end if;
end $$;

set local role service_role;
do $$
declare
  r record; rod timestamptz;
  org1 uuid := '95000000-0000-0000-0000-000000000001';
  org2 uuid := '95000000-0000-0000-0000-000000000002';
  d1 text := '{"dia":"2026-09-25","cost":1.5,"clicks":3,"prints":400,"direct_amount":20,"indirect_amount":0,"total_amount":20,"direct_units":1,"units":1}';
  d2 text := '{"dia":"2026-09-26","cost":2.25,"clicks":4,"prints":500,"direct_amount":0,"indirect_amount":10,"total_amount":10,"direct_units":0,"units":1}';
begin
  -- Posse: 1ª reserva devolve rodada; 2ª com posse viva não devolve nada; CAS do cursor.
  select * into r from public.reservar_ads_posse(org1);
  if r.rodada is null or r.cursor is not null then raise exception 'reserva inicial errada: %', r; end if;
  if exists (select 1 from public.reservar_ads_posse(org1)) then raise exception 'abriu 2ª cadeia com posse viva'; end if;
  rod := r.rodada;
  if not public.avancar_ads_cursor(org1, rod, null, '3000001') then raise exception 'CAS null→3000001 falhou'; end if;
  if public.avancar_ads_cursor(org1, rod, null, '3000002') then raise exception 'CAS com cursor velho passou'; end if;

  -- Rodada que não é a dona não grava nada.
  if public.gravar_ads_lote(org1, rod - interval '1 day', '2026-09-27T14:00:00Z',
      ('[{"ad_group_id":3000001,"tipo":"ITEM","external_id":"MLB1","campaign_id":2000001,"status":"ACTIVE","itens":["MLB1"],"dias":[' || d1 || ']}]')::jsonb)
    then raise exception 'gravou com rodada obsoleta'; end if;
  if exists (select 1 from public.ml_ads_grupo where org_id = org1) then raise exception 'rodada obsoleta deixou linha'; end if;

  -- Lote válido: FAMILY com 2 membros e 2 dias; ITEM fora de campanha (campaign_id 0).
  if not public.gravar_ads_lote(org1, rod, '2026-09-27T14:00:00Z', ('[
      {"ad_group_id":3000001,"tipo":"FAMILY","external_id":"4000001","campaign_id":2000001,"status":"ACTIVE","itens":["MLB1","MLB2"],"dias":[' || d1 || ',' || d2 || ']},
      {"ad_group_id":3000002,"tipo":"ITEM","external_id":"MLB3","campaign_id":0,"status":"PAUSED","itens":["MLB3"],"dias":[' || d2 || ']}]')::jsonb)
    then raise exception 'lote válido recusado'; end if;
  if (select count(*) from public.ml_ads_grupo_item where org_id = org1 and ad_group_id = 3000001) <> 2
    then raise exception 'membros do FAMILY errados'; end if;
  if (select sum(cost) from public.ml_ads_grupo_dia where org_id = org1) <> 6.00 then raise exception 'soma de custo errada'; end if;

  -- O mais recente vence (atribuição revisada para BAIXO também vale); itens null mantém o vínculo.
  perform public.gravar_ads_lote(org1, rod, '2026-09-28T14:00:00Z',
    '[{"ad_group_id":3000001,"tipo":"FAMILY","external_id":"4000001","campaign_id":2000001,"status":"ACTIVE","itens":null,
       "dias":[{"dia":"2026-09-26","cost":2.25,"clicks":4,"prints":500,"direct_amount":0,"indirect_amount":5,"total_amount":5,"direct_units":0,"units":1}]}]');
  if (select total_amount from public.ml_ads_grupo_dia where org_id = org1 and ad_group_id = 3000001 and dia = '2026-09-26') <> 5
    then raise exception 'releitura mais nova não substituiu'; end if;
  if (select count(*) from public.ml_ads_grupo_item where org_id = org1 and ad_group_id = 3000001) <> 2
    then raise exception 'itens null apagou o vínculo'; end if;

  -- Leitura mais velha não sobrescreve dia, metadado nem vínculo.
  perform public.gravar_ads_lote(org1, rod, '2026-09-27T10:00:00Z',
    '[{"ad_group_id":3000001,"tipo":"FAMILY","external_id":"4000001","campaign_id":2000001,"status":"PAUSED","itens":["MLB9"],
       "dias":[{"dia":"2026-09-26","cost":9,"clicks":4,"prints":500,"direct_amount":0,"indirect_amount":99,"total_amount":99,"direct_units":0,"units":1}]}]');
  if (select total_amount from public.ml_ads_grupo_dia where org_id = org1 and ad_group_id = 3000001 and dia = '2026-09-26') <> 5
    then raise exception 'leitura velha sobrescreveu o dia'; end if;
  if exists (select 1 from public.ml_ads_grupo_item where org_id = org1 and ml_item_id = 'MLB9')
    then raise exception 'leitura velha trocou o vínculo'; end if;
  if (select status from public.ml_ads_grupo where org_id = org1 and ad_group_id = 3000001) <> 'ACTIVE'
    then raise exception 'leitura velha trocou o status'; end if;

  -- Grupo fora do lote (sumiu do search) fica intacto; itens [] (lista vazia do ML) NÃO apaga o vínculo.
  if not exists (select 1 from public.ml_ads_grupo_dia where org_id = org1 and ad_group_id = 3000002)
    then raise exception 'grupo fora do lote perdeu dias'; end if;
  perform public.gravar_ads_lote(org1, rod, '2026-09-29T14:00:00Z',
    '[{"ad_group_id":3000001,"tipo":"FAMILY","external_id":"4000001","campaign_id":2000001,"status":"EMPTY","itens":[],"dias":[]}]');
  if (select count(*) from public.ml_ads_grupo_item where org_id = org1 and ad_group_id = 3000001) <> 2
    then raise exception 'itens [] apagou o vínculo gravado'; end if;
  if (select count(*) from public.ml_ads_grupo_dia where org_id = org1 and ad_group_id = 3000001) <> 2
    then raise exception 'itens [] apagou dias'; end if;
  if (select status from public.ml_ads_grupo where org_id = org1 and ad_group_id = 3000001) <> 'EMPTY'
    then raise exception 'metadado mais novo não foi gravado'; end if;
  -- Lista nova não vazia substitui o vínculo (o worker só manda quando não é menor que o gravado).
  perform public.gravar_ads_lote(org1, rod, '2026-09-29T15:00:00Z',
    '[{"ad_group_id":3000001,"tipo":"FAMILY","external_id":"4000001","campaign_id":2000001,"status":"ACTIVE","itens":["MLB1","MLB2","MLB4"],"dias":[]}]');
  if (select count(*) from public.ml_ads_grupo_item where org_id = org1 and ad_group_id = 3000001) <> 3
    then raise exception 'lista nova não substituiu o vínculo'; end if;

  -- Checks de faixa e de tipo.
  begin
    insert into public.ml_ads_grupo_dia values (org1, 3000001, '2026-09-01', -1, 0, 0, 0, 0, 0, 0, 0, now());
    raise exception 'custo negativo passou';
  exception when check_violation then null; end;
  begin
    insert into public.ml_ads_grupo_dia values (org1, 3000001, '2026-09-01', 0, -1, 0, 0, 0, 0, 0, 0, now());
    raise exception 'cliques negativos passaram';
  exception when check_violation then null; end;
  begin
    insert into public.ml_ads_grupo values (org1, 1, 'OUTRO', null, null, 'X', now());
    raise exception 'tipo inválido passou';
  exception when check_violation then null; end;

  -- concluir: rodada obsoleta não fecha; ok fecha carga, grava advertiser e cobertura.
  if public.concluir_ads_rodada(org1, rod - interval '1 day', 'ok') then raise exception 'concluir obsoleto passou'; end if;
  if not public.concluir_ads_rodada(org1, rod, 'ok', null, true, 1000001, '2026-06-29', 100.00, 97.40) then raise exception 'concluir ok falhou'; end if;
  select * into r from public.ml_ads_sync where org_id = org1;
  if r.estado <> 'ok' or not r.carga_inicial_ok or r.cobertura_desde <> '2026-06-29' or r.advertiser_id <> 1000001
     or r.cursor is not null or r.posse_ate is not null or r.ultimo_ok_em is null
     or r.custo_resumo <> 100.00 or r.custo_listado <> 97.40 then raise exception 'concluir ok errado (custos no sync?): %', r; end if;
  -- Rodada diária seguinte não recua a cobertura.
  select * into r from public.reservar_ads_posse(org1);
  perform public.concluir_ads_rodada(org1, r.rodada, 'ok', null, true, 1000001, '2026-09-12', 100.00, 97.40);
  if (select cobertura_desde from public.ml_ads_sync where org_id = org1) <> '2026-06-29' then raise exception 'cobertura recuou'; end if;
  -- Worker parado > 90 dias: a janela relida começa depois de "último ok − 14" → a cobertura avança (buraco ≠ zero).
  update public.ml_ads_sync set ultimo_ok_em = now() - interval '200 days' where org_id = org1;
  select * into r from public.reservar_ads_posse(org1);
  perform public.concluir_ads_rodada(org1, r.rodada, 'ok', null, true, 1000001, current_date - 90, 100.00, 97.40);
  if (select cobertura_desde from public.ml_ads_sync where org_id = org1) <> current_date - 90
    then raise exception 'cobertura não avançou depois do buraco'; end if;
  -- sem_permissao: guarda o motivo e preserva ultimo_ok_em.
  select * into r from public.reservar_ads_posse(org1);
  perform public.concluir_ads_rodada(org1, r.rodada, 'sem_permissao', 'ML 403 em advertisers: sem permissão de Publicidade ou conexão recusada');
  select * into r from public.ml_ads_sync where org_id = org1;
  if r.estado <> 'sem_permissao' or r.erro is null or r.ultimo_erro_em is null or r.ultimo_ok_em is null
    then raise exception 'concluir sem_permissao errado: %', r; end if;
  if r.custo_resumo is null then raise exception 'rodada sem ok apagou os custos da última rodada ok'; end if;
  -- Carga inicial interrompida: a próxima rodada retoma o cursor.
  update public.ml_ads_sync set carga_inicial_ok = false where org_id = org1;
  select * into r from public.reservar_ads_posse(org1);
  perform public.avancar_ads_cursor(org1, r.rodada, r.cursor, '3000005');
  update public.ml_ads_sync set posse_ate = now() - interval '1 minute' where org_id = org1;
  select * into r from public.reservar_ads_posse(org1);
  if r.cursor is distinct from '3000005' then raise exception 'não retomou o cursor da carga inicial: %', r; end if;

  -- Retenção: dia antes do corte sai; grupo velho sem dia retido sai com o vínculo (cascade).
  perform public.gravar_ads_lote(org1, r.rodada, '2026-01-01T00:00:00Z',
    '[{"ad_group_id":3000009,"tipo":"ITEM","external_id":"MLB8","campaign_id":0,"status":"IDLE","itens":["MLB8"],"dias":[]}]');
  perform public.limpar_ads_retencao('2026-09-26');
  if exists (select 1 from public.ml_ads_grupo_dia where org_id = org1 and dia < '2026-09-26') then raise exception 'retenção não apagou'; end if;
  if not exists (select 1 from public.ml_ads_grupo_dia where org_id = org1 and dia = '2026-09-26') then raise exception 'retenção apagou demais'; end if;
  if exists (select 1 from public.ml_ads_grupo where org_id = org1 and ad_group_id = 3000009) then raise exception 'grupo velho ficou'; end if;
  if exists (select 1 from public.ml_ads_grupo_item where org_id = org1 and ad_group_id = 3000009) then raise exception 'vínculo órfão ficou'; end if;
  if (select cobertura_desde from public.ml_ads_sync where org_id = org1) < '2026-09-26'
    then raise exception 'retenção apagou dias sem avançar a cobertura'; end if;

  -- Org 2 com dado próprio (não pode vazar para a org 1).
  select * into r from public.reservar_ads_posse(org2);
  perform public.gravar_ads_lote(org2, r.rodada, '2026-09-27T14:00:00Z',
    ('[{"ad_group_id":3000001,"tipo":"ITEM","external_id":"MLB1","campaign_id":0,"status":"ACTIVE","itens":["MLB1"],"dias":[' || d2 || ']}]')::jsonb);
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"95000000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$
declare m jsonb;
begin
  if (select count(*) from public.ml_ads_sync) <> 1 then raise exception 'RLS: viu sync de outra org'; end if;
  if exists (select 1 from public.ml_ads_grupo_dia where org_id <> '95000000-0000-0000-0000-000000000001')
    then raise exception 'RLS: viu dia de outra org'; end if;
  begin
    insert into public.ml_ads_sync (org_id, estado) values ('95000000-0000-0000-0000-000000000001', 'ok');
    raise exception 'authenticated inseriu';
  exception when insufficient_privilege then null; end;
  -- Mapa MLB → código de QUALQUER membro (inclusive o que não é do dossiê), só da própria org.
  m := public.vendas_sku_codigos_mlbs('{MLB1,MLB2,MLB7}');
  if m->'MLB1' is distinct from '["A","B"]'::jsonb then raise exception 'MLB1 errado (org 2 vazou?): %', m; end if;
  if m->'MLB2' is distinct from '["A"]'::jsonb then raise exception 'MLB2 errado: %', m; end if;
  if m ? 'MLB7' then raise exception 'MLB sem código entrou: %', m; end if;
end $$;
reset role;

set local role anon;
do $$
begin
  begin
    perform 1 from public.ml_ads_grupo_dia;
    raise exception 'anon leu';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
