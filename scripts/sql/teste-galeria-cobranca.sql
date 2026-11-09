\set ON_ERROR_STOP on
-- ADR-0201 (Galeria da cor), Task 2: tabelas, trava por MLB, saga, relógio no banco e cobrança compartilhada.
-- Rodar: python3 scripts/teste-sql-desfeito.py scripts/sql/teste-galeria-cobranca.sql supabase/migrations/<ts>_galeria_da_cor.sql
-- Sem a migration tem de FALHAR (prova de vermelho). Fixtures só em orgs próprias (is_test), tudo some no rollback.
-- now() é fixo na transação: "há 5 min", "260 min" etc. são colunas retrodatadas; o relógio é chamado direto.
begin;
set local lock_timeout = '5s';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97700000-0000-0000-0000-000000000001', 'Galeria cobra', 'galeria-cobra-teste', array['imagem_ia'], true),
  ('97700000-0000-0000-0000-000000000002', 'Galeria sem modulo', 'galeria-sem-modulo-teste', array[]::text[], true),
  ('97700000-0000-0000-0000-000000000003', 'Galeria mes fechado', 'galeria-mes-fechado-teste', array['imagem_ia'], true),
  ('97700000-0000-0000-0000-000000000004', 'Galeria previa', 'galeria-previa-teste', array['imagem_ia'], true),
  ('97700000-0000-0000-0000-000000000005', 'Galeria congelada', 'galeria-congelada-teste', array['imagem_ia'], true);
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('97700000-0000-0000-0000-000000000100', 'admin-galeria@teste.local', '{}'::jsonb,
   '{"org_id":"97700000-0000-0000-0000-000000000001"}'::jsonb);
update public.profiles set is_super_admin = true, org_id = null, is_active = true
 where id = '97700000-0000-0000-0000-000000000100';
insert into auth.users (id, email, raw_user_meta_data)
select ('97700000-0000-0000-0000-00000000010' || n)::uuid, 'galeria-' || n || '@teste.local',
       jsonb_build_object('org_id', '97700000-0000-0000-0000-00000000000' || n)
  from generate_series(1, 5) n;
insert into public.profiles (id, org_id, is_active)
select ('97700000-0000-0000-0000-00000000010' || n)::uuid, ('97700000-0000-0000-0000-00000000000' || n)::uuid, true
  from generate_series(1, 5) n
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;
-- usuário da org n
create or replace function pg_temp.u(o uuid) returns uuid language sql as $$
  select ('97700000-0000-0000-0000-00000000010' || right(o::text, 1))::uuid $$;
create or replace function pg_temp.mes() returns date language sql as $$
  select date_trunc('month', now() at time zone 'America/Fortaleza')::date $$;
create or replace function pg_temp.lote(o uuid, st text default 'concluido') returns uuid language sql as $$
  insert into public.lotes (user_id, org_id, status, origem) values (pg_temp.u(o), o, st::public.lote_status, 'manual')
  returning id $$;
create or replace function pg_temp.familia(o uuid, l uuid, cp text, st text default 'publicado') returns uuid language sql as $$
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, status)
  values (l, pg_temp.u(o), o, cp, cp, 'CREATE', 'nacional', gen_random_uuid(), st::public.familia_status) returning id $$;
create or replace function pg_temp.anuncio(o uuid, cp text, part int default 0) returns uuid language sql as $$
  insert into public.anuncios_externos (user_id, org_id, canal, codigo_pai, particao, status)
  values (pg_temp.u(o), o, 'mercado_livre', cp, part, 'publicado') returning id $$;
create or replace function pg_temp.roteiro(o uuid, an uuid, fam uuid, v int, st text) returns uuid language sql as $$
  insert into public.galeria_roteiros (org_id, anuncio_externo_id, familia_id, versao, conteudo, fatos_hash, moda, status)
  values (o, an, fam, v, '{}'::jsonb, 'h1', false, st) returning id $$;
create or replace function pg_temp.termos(o uuid, unit bigint) returns uuid language sql as $$
  insert into public.platform_commercial_terms (org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4, sonar_unit_cents, image_unit_cents,
    setup_fee_cents, setup_due_month, reason, created_by, version)
  values (o, (pg_temp.mes() - interval '1 month')::date, 2, 0, 700, 600, 550, 500, 0, unit, 0, null, 'galeria',
    '97700000-0000-0000-0000-000000000100', 1) returning id $$;
-- reserva de pedido (id opcional)
create or replace function pg_temp.pedido(o uuid, an uuid, fam uuid, rot uuid, unit bigint, terms uuid, eleg boolean,
  itens jsonb, pid uuid default gen_random_uuid()) returns setof public.galeria_imagens language sql as $$
  select * from public.galeria_reservar_pedido(jsonb_build_object('id', pid, 'org_id', o, 'anuncio_externo_id', an,
    'familia_id', fam, 'roteiro_id', rot, 'unit_cents', unit, 'terms_id', terms, 'elegivel', eleg, 'itens', itens)) $$;
create or replace function pg_temp.uma(o uuid, an uuid, fam uuid, rot uuid, unit bigint, terms uuid, eleg boolean,
  cor text, missao int, origem text default 'gerador') returns uuid language sql as $$
  select id from pg_temp.pedido(o, an, fam, rot, unit, terms, eleg,
    jsonb_build_array(jsonb_build_object('cor', cor, 'missao', missao, 'origem', origem))) $$;
create or replace function pg_temp.produzir(img uuid, st text default 'gerada') returns void language sql as $$
  update public.galeria_imagens set status = st, cena_path = 'x/galeria-ia/cena-' || img || '.jpg', custo_usd = 0.04
   where id = img $$;
create or replace function pg_temp.aplicacao(o uuid, an uuid, fam uuid, rot uuid, itens text[], st text,
  manifesto jsonb default '[]'::jsonb) returns uuid language plpgsql as $$
declare a uuid;
begin
  insert into public.galeria_aplicacoes (org_id, anuncio_externo_id, familia_id, cor, modo, manifesto, roteiro_id,
    fatos_hash, status)
  values (o, an, fam, 'Preto', 'substituir', manifesto, rot, 'h1', st) returning id into a;
  insert into public.galeria_aplicacao_itens (org_id, anuncio_externo_id, aplicacao_id, item_id)
  select o, an, a, i from unnest(itens) i;
  return a;
end $$;
create or replace function pg_temp.item(a uuid, mlb text) returns uuid language sql as $$
  select id from public.galeria_aplicacao_itens where aplicacao_id = a and item_id = mlb $$;
-- põe o item em execução com posse
create or replace function pg_temp.rodando(a uuid, mlb text, st text, posse uuid) returns void language sql as $$
  update public.galeria_aplicacao_itens set status = st, posse = rodando.posse, lease_ate = now() - interval '1 second'
   where aplicacao_id = a and item_id = mlb $$;

-- ═════════════ 1. Cobrança: reserva, exibição, idempotência ═════════════
do $$
declare
  o uuid := '97700000-0000-0000-0000-000000000001';
  l uuid; fa uuid; fb uuid; an1 uuid; an2 uuid; ra uuid; rb uuid; t uuid;
  p1 uuid := gen_random_uuid();
  ids uuid[]; ids2 uuid[]; n int; img uuid;
begin
  l := pg_temp.lote(o);
  fa := pg_temp.familia(o, l, '09770000');
  fb := pg_temp.familia(o, pg_temp.lote(o), '09770000');
  an1 := pg_temp.anuncio(o, '09770000', 0);
  an2 := pg_temp.anuncio(o, '09770000', 1);
  perform set_config('teste.an1', an1::text, true);
  perform set_config('teste.fa', fa::text, true);
  ra := pg_temp.roteiro(o, an1, fa, 1, 'aprovado');
  perform set_config('teste.ra', ra::text, true);
  t := pg_temp.termos(o, 80);
  perform set_config('teste.t1', t::text, true);

  -- Pedido com 6 imagens (2 cores × 3 missões) → 6 request_id distintos, geração 1, receita v5 fixa.
  select array_agg(id order by cor, missao) into ids from pg_temp.pedido(o, an1, fa, ra, 50, t, true,
    '[{"cor":"Preto","missao":1},{"cor":"Preto","missao":2},{"cor":"Preto","missao":3},
      {"cor":"Branco","missao":1},{"cor":"Branco","missao":2},{"cor":"Branco","missao":3}]'::jsonb, p1);
  perform pg_temp.afirmar(cardinality(ids) = 6, 'pedido não criou 6 imagens');
  perform pg_temp.afirmar((select count(distinct request_id) = 6 and bool_and(geracao = 1 and status = 'pendente')
    from public.galeria_imagens where pedido_id = p1), 'request_id repetido ou geração/status errados');
  perform pg_temp.afirmar((select request_id = extensions.uuid_generate_v5(p1, 'Preto:1:1')
    from public.galeria_imagens where pedido_id = p1 and cor = 'Preto' and missao = 1), 'receita do request_id mudou');
  perform pg_temp.afirmar((select unit_cents = 50 and terms_id = t and elegivel from public.galeria_pedidos where id = p1),
    'pedido não congelou preço/termos/elegibilidade');

  -- Repetir o mesmo id devolve as mesmas linhas; com outro anúncio é recusado.
  select array_agg(id order by cor, missao) into ids2 from pg_temp.pedido(o, an1, fa, ra, 50, t, true,
    '[{"cor":"Preto","missao":1}]'::jsonb, p1);
  perform pg_temp.afirmar(ids2 = ids, 'repetição do pedido não devolveu as mesmas linhas');
  perform pg_temp.afirmar((select count(*) = 6 from public.galeria_imagens where pedido_id = p1), 'repetição criou linhas');
  begin
    perform pg_temp.pedido(o, an2, fa, ra, 50, t, true, '[{"cor":"Preto","missao":1}]'::jsonb, p1);
    raise exception 'FALHA: pedido repetido em outro anúncio aceito';
  exception when insufficient_privilege then null;
  end;

  -- Confirmação das 6 produzidas → 6 entregas galeria a 50 (termos do mês = 80); repetir → 0.
  perform pg_temp.produzir(i) from unnest(ids) i;
  n := public.galeria_confirmar_exibicao(o, an1, ids);
  perform pg_temp.afirmar(n = 6, 'confirmação não cobrou 6: ' || n);
  perform pg_temp.afirmar((select count(*) = 6 and bool_and(d.units = 1 and d.origem = 'galeria' and d.unit_cents = 50
      and d.total_cents = 50 and d.terms_id = t and d.cost_usd = 0.04 and d.month = pg_temp.mes() and d.reason is null)
    from public.platform_image_deliveries d join public.galeria_imagens g on g.request_id = d.request_id and g.org_id = d.org_id
    where g.pedido_id = p1), 'entregas da galeria erradas');
  n := public.galeria_confirmar_exibicao(o, an1, ids);
  perform pg_temp.afirmar(n = 0, 'segunda confirmação cobrou de novo');
  perform pg_temp.afirmar((select count(*) = 6 from public.platform_image_deliveries d
    join public.galeria_imagens g on g.request_id = d.request_id where g.pedido_id = p1), 'entregas duplicadas');

  -- gerando com cena e custo → 0 e não grava entregue_em; virou gerada → cobra 1.
  img := pg_temp.uma(o, an1, fa, ra, 50, t, true, 'Azul', 1);
  perform pg_temp.produzir(img, 'gerando');
  n := public.galeria_confirmar_exibicao(o, an1, array[img]);
  perform pg_temp.afirmar(n = 0 and (select entregue_em is null from public.galeria_imagens where id = img),
    'imagem gerando foi cobrada/marcada');
  update public.galeria_imagens set status = 'gerada' where id = img;
  perform pg_temp.afirmar(public.galeria_confirmar_exibicao(o, an1, array[img]) = 1, 'gerada depois não cobrou');

  -- custo nulo → 0 e sem entregue_em.
  img := pg_temp.uma(o, an1, fa, ra, 50, t, true, 'Azul', 2);
  update public.galeria_imagens set status = 'gerada', cena_path = 'x', custo_usd = null where id = img;
  perform pg_temp.afirmar(public.galeria_confirmar_exibicao(o, an1, array[img]) = 0
    and (select entregue_em is null from public.galeria_imagens where id = img), 'custo nulo cobrado');

  -- recorte → 0.
  img := pg_temp.uma(o, an1, fa, ra, 50, t, true, 'Azul', 7, 'recorte');
  perform pg_temp.produzir(img);
  perform pg_temp.afirmar(public.galeria_confirmar_exibicao(o, an1, array[img]) = 0, 'recorte cobrado');

  -- aprovada antes da confirmação → cobra 1; confirmação antes e aprovação depois → 1 cobrança só.
  img := pg_temp.uma(o, an1, fa, ra, 50, t, true, 'Azul', 3);
  perform pg_temp.produzir(img, 'aprovada');
  perform pg_temp.afirmar(public.galeria_confirmar_exibicao(o, an1, array[img]) = 1, 'aprovada antes não cobrou');
  img := pg_temp.uma(o, an1, fa, ra, 50, t, true, 'Azul', 4);
  perform pg_temp.produzir(img);
  perform pg_temp.afirmar(public.galeria_confirmar_exibicao(o, an1, array[img]) = 1, 'confirmação não cobrou');
  update public.galeria_imagens set status = 'aprovada' where id = img;
  perform pg_temp.afirmar(public.galeria_confirmar_exibicao(o, an1, array[img]) = 0
    and (select count(*) = 1 from public.platform_image_deliveries d join public.galeria_imagens g
          on g.request_id = d.request_id where g.id = img), 'aprovação depois cobrou duas vezes');

  -- Imagem da família A confirmada depois que o roteiro de B virou o vigente no mesmo anúncio → cobra 1.
  img := pg_temp.uma(o, an1, fa, ra, 50, t, true, 'Azul', 5);
  perform pg_temp.produzir(img);
  update public.galeria_roteiros set status = 'desatualizado' where id = ra;
  rb := pg_temp.roteiro(o, an1, fb, 1, 'aprovado');
  -- id de outro anúncio (outra partição do mesmo produto) → 0.
  perform pg_temp.afirmar(public.galeria_confirmar_exibicao(o, an2, array[img]) = 0, 'outro anúncio cobrou');
  perform pg_temp.afirmar(public.galeria_confirmar_exibicao(o, an1, array[img]) = 1, 'família anterior não cobrou');
  -- outra org → 0.
  perform pg_temp.afirmar(public.galeria_confirmar_exibicao('97700000-0000-0000-0000-000000000002', an1, array[img]) = 0,
    'outra org cobrou');

  -- elegivel = false sem termos no pedido e contrato (t) assinado antes da exibição → units 0.
  img := pg_temp.uma(o, an1, fb, rb, 0, null, false, 'Azul', 6);
  perform pg_temp.produzir(img);
  perform pg_temp.afirmar(public.galeria_confirmar_exibicao(o, an1, array[img]) = 1, 'não elegível não registrou');
  perform pg_temp.afirmar((select d.units = 0 and d.total_cents = 0 and d.reason = 'sem_condicao_comercial'
    from public.platform_image_deliveries d join public.galeria_imagens g on g.request_id = d.request_id where g.id = img),
    'pedido não elegível foi cobrado');
end $$;

-- ═════════════ 2. Congelamento: módulo, termos, mês fechado e prévia ═════════════
do $$
declare
  o2 uuid := '97700000-0000-0000-0000-000000000002';
  o3 uuid := '97700000-0000-0000-0000-000000000003';
  o4 uuid := '97700000-0000-0000-0000-000000000004';
  o5 uuid := '97700000-0000-0000-0000-000000000005';
  adm uuid := '97700000-0000-0000-0000-000000000100';
  l uuid; f uuid; an uuid; r uuid; t uuid; img uuid; prev jsonb; linha jsonb;
begin
  -- Org sem módulo (pedido não elegível com termos) → units 0, modulo_desligado.
  l := pg_temp.lote(o2); f := pg_temp.familia(o2, l, '09771000'); an := pg_temp.anuncio(o2, '09771000');
  r := pg_temp.roteiro(o2, an, f, 1, 'aprovado'); t := pg_temp.termos(o2, 80);
  img := pg_temp.uma(o2, an, f, r, 80, t, false, 'Preto', 1);
  perform pg_temp.produzir(img);
  perform public.galeria_confirmar_exibicao(o2, an, array[img]);
  perform pg_temp.afirmar((select d.units = 0 and d.reason = 'modulo_desligado' and d.origem = 'galeria'
    from public.platform_image_deliveries d join public.galeria_imagens g on g.request_id = d.request_id where g.id = img),
    'org sem módulo cobrada');

  -- Mês fechado → competência seguinte, com o preço do pedido.
  l := pg_temp.lote(o3); f := pg_temp.familia(o3, l, '09772000'); an := pg_temp.anuncio(o3, '09772000');
  r := pg_temp.roteiro(o3, an, f, 1, 'aprovado'); t := pg_temp.termos(o3, 80);
  insert into public.platform_billing_statements (org_id, month, terms_id, revenue_bps, gross_cents, refund_cents,
    base_cents, fee_cents, sonar_cents, credit_cents, total_cents, revision, snapshot, closed_by)
  values (o3, pg_temp.mes(), t, 700, 0, 0, 0, 0, 0, 0, 0, 'rev-galeria', '{}'::jsonb, adm);
  img := pg_temp.uma(o3, an, f, r, 50, t, true, 'Preto', 1);
  perform pg_temp.produzir(img);
  perform public.galeria_confirmar_exibicao(o3, an, array[img]);
  perform pg_temp.afirmar((select d.month = (pg_temp.mes() + interval '1 month')::date and d.units = 1 and d.unit_cents = 50
    from public.platform_image_deliveries d join public.galeria_imagens g on g.request_id = d.request_id where g.id = img),
    'entrega caiu em competência fechada');

  -- Termos e módulo alterados depois do pedido → cobra igual ao pedido.
  l := pg_temp.lote(o5); f := pg_temp.familia(o5, l, '09773000'); an := pg_temp.anuncio(o5, '09773000');
  r := pg_temp.roteiro(o5, an, f, 1, 'aprovado'); t := pg_temp.termos(o5, 80);
  img := pg_temp.uma(o5, an, f, r, 80, t, true, 'Preto', 1);
  perform pg_temp.produzir(img);
  update public.organizations set modulos_habilitados = array[]::text[] where id = o5;
  insert into public.platform_commercial_terms (org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4, sonar_unit_cents, image_unit_cents,
    setup_fee_cents, setup_due_month, reason, created_by, version)
  values (o5, pg_temp.mes(), 2, 0, 700, 600, 550, 500, 0, 999, 0, null, 'reajuste', adm, 1);
  perform public.galeria_registrar_entrega(img);
  perform pg_temp.afirmar((select d.units = 1 and d.unit_cents = 80 and d.total_cents = 80 and d.terms_id = t
    from public.platform_image_deliveries d join public.galeria_imagens g on g.request_id = d.request_id where g.id = img),
    'registrar_entrega leu termos/módulo atuais');

  -- Prévia vigente (sem alteração): um preço → 50 na linha e soma 50; 50 + 80 no mês → null e 130.
  l := pg_temp.lote(o4); f := pg_temp.familia(o4, l, '09774000'); an := pg_temp.anuncio(o4, '09774000');
  r := pg_temp.roteiro(o4, an, f, 1, 'aprovado'); t := pg_temp.termos(o4, 80);
  img := pg_temp.uma(o4, an, f, r, 50, t, true, 'Preto', 1);
  perform pg_temp.produzir(img);
  perform public.galeria_confirmar_exibicao(o4, an, array[img]);
  prev := public.platform_billing_preview(adm, o4, pg_temp.mes());
  select l2 into linha from jsonb_array_elements(prev->'lines') l2 where l2->>'key' = 'image_ia';
  perform pg_temp.afirmar((linha->>'unit_cents')::bigint = 50 and (linha->>'amount_cents')::bigint = 50
    and (prev->>'image_cents')::bigint = 50, 'prévia com um preço: ' || coalesce(linha::text, 'sem linha'));
  img := pg_temp.uma(o4, an, f, r, 80, t, true, 'Branco', 1);
  perform pg_temp.produzir(img);
  perform public.galeria_confirmar_exibicao(o4, an, array[img]);
  prev := public.platform_billing_preview(adm, o4, pg_temp.mes());
  select l2 into linha from jsonb_array_elements(prev->'lines') l2 where l2->>'key' = 'image_ia';
  perform pg_temp.afirmar(linha->'unit_cents' = 'null'::jsonb and (linha->>'amount_cents')::bigint = 130
    and (prev->>'image_cents')::bigint = 130, 'prévia com dois preços: ' || coalesce(linha::text, 'sem linha'));
end $$;

-- ═════════════ 3. Vagas, teto e em_andamento ═════════════
do $$
declare
  o uuid := '97700000-0000-0000-0000-000000000001';
  t uuid := current_setting('teste.t1')::uuid;
  l uuid; f uuid; an uuid; r1 uuid; r2 uuid; img uuid; k int;
begin
  l := pg_temp.lote(o); f := pg_temp.familia(o, l, '09775000'); an := pg_temp.anuncio(o, '09775000');
  r1 := pg_temp.roteiro(o, an, f, 1, 'aprovado');
  -- 3 falhou + 1 entregue → a entregue tem geração 1.
  for k in 1..3 loop
    img := pg_temp.uma(o, an, f, r1, 50, t, true, 'Verde', 2);
    perform pg_temp.afirmar((select geracao = 1 from public.galeria_imagens where id = img), 'falha gastou vaga');
    update public.galeria_imagens set status = 'falhou' where id = img;
  end loop;
  img := pg_temp.uma(o, an, f, r1, 50, t, true, 'Verde', 2);
  perform pg_temp.produzir(img);
  perform public.galeria_confirmar_exibicao(o, an, array[img]);
  perform pg_temp.afirmar((select geracao = 1 and entregue_em is not null from public.galeria_imagens where id = img),
    'entregue após 3 falhas não é a geração 1');
  -- Geração aberta → em_andamento.
  img := pg_temp.uma(o, an, f, r1, 50, t, true, 'Verde', 2);
  perform pg_temp.afirmar((select geracao = 2 from public.galeria_imagens where id = img), 'segunda vaga não é 2');
  begin
    perform pg_temp.uma(o, an, f, r1, 50, t, true, 'Verde', 2);
    raise exception 'FALHA: geração aberta aceitou outro pedido';
  exception when raise_exception then
    if sqlerrm <> 'em_andamento' then raise; end if;
  end;
  -- Uma desatualizada sem entrega → a próxima nasce geração 2.
  img := pg_temp.uma(o, an, f, r1, 50, t, true, 'Verde', 3);
  update public.galeria_imagens set status = 'desatualizada' where id = img;
  img := pg_temp.uma(o, an, f, r1, 50, t, true, 'Verde', 3);
  perform pg_temp.afirmar((select geracao = 2 from public.galeria_imagens where id = img), 'desatualizada não ocupou a vaga');
  -- 3 gerações produzidas sem nenhuma exibida → teto.
  for k in 1..3 loop
    img := pg_temp.uma(o, an, f, r1, 50, t, true, 'Verde', 4);
    perform pg_temp.produzir(img);
  end loop;
  begin
    perform pg_temp.uma(o, an, f, r1, 50, t, true, 'Verde', 4);
    raise exception 'FALHA: quarta geração aceita';
  exception when raise_exception then
    if sqlerrm <> 'teto' then raise; end if;
  end;
  -- Roteiro v2 (R8.2): novas vagas, a partir da geração 1.
  update public.galeria_roteiros set status = 'desatualizado' where id = r1;
  r2 := pg_temp.roteiro(o, an, f, 2, 'aprovado');
  img := pg_temp.uma(o, an, f, r2, 50, t, true, 'Verde', 4);
  perform pg_temp.afirmar((select geracao = 1 from public.galeria_imagens where id = img), 'v2 não abriu vagas novas');
end $$;

-- ═════════════ 4. Roteiros: um aprovado por anúncio ═════════════
do $$
declare
  o uuid := '97700000-0000-0000-0000-000000000001';
  l uuid; fa uuid; fb uuid; an1 uuid; an2 uuid; ra uuid; rb uuid; rb2 uuid; rp2 uuid;
begin
  l := pg_temp.lote(o);
  fa := pg_temp.familia(o, l, '09776000'); fb := pg_temp.familia(o, pg_temp.lote(o), '09776000');
  an1 := pg_temp.anuncio(o, '09776000', 0); an2 := pg_temp.anuncio(o, '09776000', 1);
  ra := pg_temp.roteiro(o, an1, fa, 1, 'aprovado');
  rp2 := pg_temp.roteiro(o, an2, fa, 1, 'aprovado');
  rb := pg_temp.roteiro(o, an1, fb, 1, 'rascunho');
  -- Aprovar o de B (vigente) desatualiza o de A antes, sem estourar o índice.
  update public.galeria_roteiros set status = 'desatualizado' where anuncio_externo_id = an1 and status = 'aprovado';
  update public.galeria_roteiros set status = 'aprovado' where id = rb;
  perform pg_temp.afirmar((select status = 'desatualizado' from public.galeria_roteiros where id = ra), 'A não desatualizou');
  rb2 := pg_temp.roteiro(o, an1, fb, 2, 'rascunho');
  update public.galeria_roteiros set status = 'desatualizado' where anuncio_externo_id = an1 and status = 'aprovado';
  update public.galeria_roteiros set status = 'aprovado' where id = rb2;
  perform pg_temp.afirmar((select count(*) = 1 from public.galeria_roteiros where anuncio_externo_id = an1 and status = 'aprovado'),
    'mais de um aprovado no anúncio');
  begin
    update public.galeria_roteiros set status = 'aprovado' where id = rb;
    raise exception 'FALHA: segundo aprovado no mesmo anúncio aceito';
  exception when unique_violation then null;
  end;
  -- A partição 2 tem o próprio aprovado, intocado.
  perform pg_temp.afirmar((select status = 'aprovado' from public.galeria_roteiros where id = rp2), 'partição 2 mudou');
end $$;

-- ═════════════ 5. Trava de escrita por MLB ═════════════
do $$
declare
  o uuid := '97700000-0000-0000-0000-000000000001';
  x uuid := gen_random_uuid(); y uuid := gen_random_uuid(); w uuid := gen_random_uuid();
  e timestamptz;
begin
  perform pg_temp.afirmar(public.ml_travar_itens(o, array['MLB-G1'], 'galeria', x, null), 'galeria não travou item livre');
  perform pg_temp.afirmar((select expira_em is null and dono_tipo = 'galeria' from public.ml_item_travas
    where org_id = o and item_id = 'MLB-G1'), 'trava galeria com expiração');
  -- P livre, M livre, G travado por outro → false e nenhuma linha gravada.
  perform pg_temp.afirmar(not public.ml_travar_itens(o, array['MLB-P1', 'MLB-M1', 'MLB-G1'], 'escritor', y, 600),
    'escritor travou item da galeria');
  perform pg_temp.afirmar((select count(*) = 0 from public.ml_item_travas where org_id = o and item_id in ('MLB-P1', 'MLB-M1')),
    'trava parcial gravada');
  perform pg_temp.afirmar((select dono_id = x from public.ml_item_travas where org_id = o and item_id = 'MLB-G1'),
    'trava galeria mudou de dono');
  -- Reentrada da própria galeria é permitida.
  perform pg_temp.afirmar(public.ml_travar_itens(o, array['MLB-G1'], 'galeria', x, null), 'reentrada da galeria negada');
  -- Escritor vencido é tomado.
  insert into public.ml_item_travas (org_id, item_id, dono_tipo, dono_id, expira_em)
  values (o, 'MLB-E1', 'escritor', y, now() - interval '1 second');
  perform pg_temp.afirmar(public.ml_travar_itens(o, array['MLB-E1'], 'escritor', w, 600), 'escritor vencido não foi tomado');
  perform pg_temp.afirmar((select dono_id = w and expira_em = now() + interval '600 seconds' from public.ml_item_travas
    where org_id = o and item_id = 'MLB-E1'), 'trava tomada com dono/expiração errados');
  -- Escritor vigente de outro dono bloqueia.
  perform pg_temp.afirmar(not public.ml_travar_itens(o, array['MLB-E1'], 'escritor', y, 600), 'escritor vigente foi tomado');
  -- Extensão: só o dono, greatest, nunca encurta.
  perform pg_temp.afirmar(public.ml_estender_trava(o, array['MLB-E1'], w, 900), 'dono não estendeu');
  select expira_em into e from public.ml_item_travas where org_id = o and item_id = 'MLB-E1';
  perform pg_temp.afirmar(e = now() + interval '900 seconds', 'extensão errada');
  perform pg_temp.afirmar(public.ml_estender_trava(o, array['MLB-E1'], w, 1), 'dono não estendeu (1 s)');
  perform pg_temp.afirmar((select expira_em = e from public.ml_item_travas where org_id = o and item_id = 'MLB-E1'), 'extensão encurtou');
  perform pg_temp.afirmar(not public.ml_estender_trava(o, array['MLB-E1'], y, 900), 'outro dono estendeu');
  -- Quarentena vigente bloqueia qualquer dono, inclusive o próprio; vencida é tomada.
  insert into public.ml_item_travas (org_id, item_id, dono_tipo, dono_id, expira_em)
  values (o, 'MLB-Q1', 'quarentena', x, now() + interval '5 minutes'), (o, 'MLB-Q2', 'quarentena', w, now() + interval '5 minutes');
  perform pg_temp.afirmar(not public.ml_travar_itens(o, array['MLB-Q1'], 'galeria', x, null), 'quarentena própria não bloqueou');
  perform pg_temp.afirmar(not public.ml_travar_itens(o, array['MLB-Q1'], 'escritor', y, 600), 'quarentena não bloqueou escritor');
  update public.ml_item_travas set expira_em = now() - interval '1 second' where org_id = o and item_id = 'MLB-Q1';
  perform pg_temp.afirmar(public.ml_travar_itens(o, array['MLB-Q1'], 'galeria', x, null), 'quarentena vencida negada');
  perform pg_temp.afirmar((select dono_tipo = 'galeria' and expira_em is null from public.ml_item_travas where org_id = o and item_id = 'MLB-Q1'),
    'quarentena vencida não foi tomada');
  -- Soltar: só as travas escritor do dono (nunca quarentena).
  perform pg_temp.afirmar(public.ml_soltar_itens(o, w) = 1, 'soltar não apagou só a trava escritor');
  perform pg_temp.afirmar((select count(*) = 1 from public.ml_item_travas where org_id = o and item_id = 'MLB-Q2'),
    'soltar apagou quarentena');
  -- Invariante: galeria ⇔ sem expiração.
  begin
    insert into public.ml_item_travas (org_id, item_id, dono_tipo, dono_id, expira_em)
    values (o, 'MLB-Z1', 'galeria', x, now());
    raise exception 'FALHA: galeria com expiração aceita';
  exception when check_violation then null;
  end;
end $$;

-- ═════════════ 6. Saga: confirmar, concluir, agregação, quarentena ═════════════
do $$
declare
  o uuid := '97700000-0000-0000-0000-000000000001';
  outro uuid := gen_random_uuid();
  l uuid; f uuid; an uuid; r uuid; img uuid; a uuid; a2 uuid; s text;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
begin
  l := pg_temp.lote(o); f := pg_temp.familia(o, l, '09777000'); an := pg_temp.anuncio(o, '09777000');
  perform set_config('teste.l7', l::text, true);
  perform set_config('teste.f7', f::text, true);
  perform set_config('teste.an7', an::text, true);
  r := pg_temp.roteiro(o, an, f, 1, 'aprovado');
  perform set_config('teste.r7', r::text, true);
  img := pg_temp.uma(o, an, f, r, 50, current_setting('teste.t1')::uuid, true, 'Preto', 1);
  perform pg_temp.produzir(img, 'aprovada');
  update public.galeria_imagens set final_sha256 = 'sha-1' where id = img;

  -- Confirmar: ok → em_andamento, prazo 30 min, ciclo 3 h, travas galeria nos 3 itens.
  a := pg_temp.aplicacao(o, an, f, r, array['MLB-S1', 'MLB-S2', 'MLB-S3'], 'preparada',
    jsonb_build_array(jsonb_build_object('imagem_id', img, 'missao', 1, 'final_sha256', 'sha-1')));
  s := public.galeria_confirmar_aplicacao(o, f, a, r, 'h1');
  perform pg_temp.afirmar(s = 'ok', 'confirmar: ' || s);
  perform pg_temp.afirmar((select status = 'em_andamento' and prazo_ate = now() + interval '30 minutes'
    and ciclo_ate = now() + interval '3 hours' from public.galeria_aplicacoes where id = a), 'confirmar não gravou estado/relógio');
  perform pg_temp.afirmar((select count(*) = 3 and bool_and(dono_tipo = 'galeria' and expira_em is null)
    from public.ml_item_travas where dono_id = a), 'confirmar não travou os 3 itens');
  begin
    update public.galeria_aplicacoes set manifesto = '[]'::jsonb where id = a;
    raise exception 'FALHA: manifesto alterado';
  exception when check_violation then null;
  end;

  -- G ocupado → item_ocupado, continua preparada, zero travas.
  insert into public.ml_item_travas (org_id, item_id, dono_tipo, dono_id, expira_em)
  values (o, 'MLB-T3', 'escritor', outro, now() + interval '10 minutes');
  a2 := pg_temp.aplicacao(o, an, f, r, array['MLB-T1', 'MLB-T2', 'MLB-T3'], 'preparada');
  s := public.galeria_confirmar_aplicacao(o, f, a2, r, 'h1');
  perform pg_temp.afirmar(s = 'item_ocupado' and (select status = 'preparada' from public.galeria_aplicacoes where id = a2)
    and not exists (select 1 from public.ml_item_travas where dono_id = a2), 'item ocupado: ' || s);
  -- Roteiro ou fatos_hash diferentes → desatualizada, continua preparada, zero travas.
  update public.ml_item_travas set expira_em = now() - interval '1 second' where org_id = o and item_id = 'MLB-T3';
  s := public.galeria_confirmar_aplicacao(o, f, a2, gen_random_uuid(), 'h1');
  perform pg_temp.afirmar(s = 'desatualizada' and (select status = 'preparada' from public.galeria_aplicacoes where id = a2)
    and not exists (select 1 from public.ml_item_travas where dono_id = a2), 'roteiro diferente: ' || s);
  s := public.galeria_confirmar_aplicacao(o, f, a2, r, 'h2');
  perform pg_temp.afirmar(s = 'desatualizada' and not exists (select 1 from public.ml_item_travas where dono_id = a2),
    'fatos diferentes: ' || s);
  -- Imagem do manifesto voltou a gerada (geração 2 aprovada depois do preparar) → desatualizada.
  a2 := pg_temp.aplicacao(o, an, f, r, array['MLB-T4'], 'preparada',
    jsonb_build_array(jsonb_build_object('imagem_id', img, 'missao', 1, 'final_sha256', 'sha-1')));
  update public.galeria_imagens set status = 'gerada' where id = img;
  s := public.galeria_confirmar_aplicacao(o, f, a2, r, 'h1');
  perform pg_temp.afirmar(s = 'desatualizada' and not exists (select 1 from public.ml_item_travas where dono_id = a2),
    'manifesto desatualizado: ' || s);
  -- Escrita adiada com itens sobrepostos → escrita_pendente, zero travas (confirmar e reverter).
  insert into public.ml_escritas_adiadas (org_id, familia_id, lote_id, endpoint, itens, job)
  values (o, f, l, 'update-familia-ml', array['MLB-U1', 'MLB-U9'], '{}'::jsonb);
  a2 := pg_temp.aplicacao(o, an, f, r, array['MLB-U1', 'MLB-U2'], 'preparada');
  s := public.galeria_confirmar_aplicacao(o, f, a2, r, 'h1');
  perform pg_temp.afirmar(s = 'escrita_pendente' and (select status = 'preparada' from public.galeria_aplicacoes where id = a2)
    and not exists (select 1 from public.ml_item_travas where dono_id = a2), 'confirmar com escrita adiada: ' || s);
  a2 := pg_temp.aplicacao(o, an, f, r, array['MLB-U1'], 'aplicada');
  s := public.galeria_iniciar_reversao(o, f, a2);
  perform pg_temp.afirmar(s = 'escrita_pendente' and (select status = 'aplicada' from public.galeria_aplicacoes where id = a2)
    and not exists (select 1 from public.ml_item_travas where dono_id = a2), 'reverter com escrita adiada: ' || s);
  -- Reverter com item ocupado → item_ocupado, continua aplicada.
  insert into public.ml_item_travas (org_id, item_id, dono_tipo, dono_id, expira_em)
  values (o, 'MLB-V1', 'escritor', outro, now() + interval '10 minutes');
  a2 := pg_temp.aplicacao(o, an, f, r, array['MLB-V1'], 'aplicada');
  s := public.galeria_iniciar_reversao(o, f, a2);
  perform pg_temp.afirmar(s = 'item_ocupado' and (select status = 'aplicada' from public.galeria_aplicacoes where id = a2),
    'reverter ocupado: ' || s);

  -- concluir_item: outro item ainda aplicando → aplicação inalterada e travas mantidas; posse errada → nada.
  perform pg_temp.rodando(a, 'MLB-S1', 'aplicando', p1);
  perform pg_temp.rodando(a, 'MLB-S2', 'aplicando', p2);
  perform pg_temp.rodando(a, 'MLB-S3', 'aplicando', p3);
  s := public.galeria_concluir_item(pg_temp.item(a, 'MLB-S1'), p1, 'aplicado', '{"fotos_depois":["f1"]}');
  perform pg_temp.afirmar(s = 'em_andamento' and (select count(*) = 3 from public.ml_item_travas where dono_id = a),
    'concluir com itens abertos: ' || s);
  perform pg_temp.afirmar((select status = 'aplicado' and fotos_depois = '["f1"]'::jsonb and posse is null
    from public.galeria_aplicacao_itens where id = pg_temp.item(a, 'MLB-S1')), 'item concluído errado');
  s := public.galeria_concluir_item(pg_temp.item(a, 'MLB-S2'), p1, 'aplicado', '{}');
  perform pg_temp.afirmar(s = 'em_andamento' and (select status = 'aplicando' and posse = p2
    from public.galeria_aplicacao_itens where id = pg_temp.item(a, 'MLB-S2')), 'posse errada gravou');
  perform public.galeria_concluir_item(pg_temp.item(a, 'MLB-S2'), p2, 'aplicado', '{}');
  -- Último item terminal com PUT há 5 min → aplicada; S1/S2 soltas, S3 em quarentena até put_em + 15 min.
  update public.galeria_aplicacao_itens set put_em = now() - interval '5 minutes' where id = pg_temp.item(a, 'MLB-S3');
  s := public.galeria_concluir_item(pg_temp.item(a, 'MLB-S3'), p3, 'aplicado', '{}');
  perform pg_temp.afirmar(s = 'aplicada' and (select status = 'aplicada' from public.galeria_aplicacoes where id = a),
    'todos aplicado não fechou: ' || s);
  perform pg_temp.afirmar((select count(*) = 1 from public.ml_item_travas where dono_id = a)
    and (select dono_tipo = 'quarentena' and expira_em = now() + interval '10 minutes' from public.ml_item_travas
         where org_id = o and item_id = 'MLB-S3'), 'travas não soltas / quarentena errada');
  perform pg_temp.afirmar(not public.ml_travar_itens(o, array['MLB-S3'], 'escritor', outro, 600),
    'escritor travou durante a quarentena');
  -- Quarentena vigente bloqueia a reversão da própria aplicação; vencida libera.
  s := public.galeria_iniciar_reversao(o, f, a);
  perform pg_temp.afirmar(s = 'item_ocupado' and (select status = 'aplicada' from public.galeria_aplicacoes where id = a),
    'reversão na quarentena: ' || s);
  update public.ml_item_travas set expira_em = now() - interval '1 second' where org_id = o and item_id = 'MLB-S3';
  s := public.galeria_iniciar_reversao(o, null, a);
  perform pg_temp.afirmar(s = 'ok' and (select status = 'revertendo' and ciclo_ate = now() + interval '3 hours'
    from public.galeria_aplicacoes where id = a), 'reversão depois da quarentena: ' || s);
  perform pg_temp.afirmar((select count(*) = 3 and bool_and(status = 'compensando' and compensar_ate = now() + interval '60 minutes')
    from public.galeria_aplicacao_itens where aplicacao_id = a), 'reversão não pôs os itens em compensando');
  perform pg_temp.afirmar((select count(*) = 3 from public.ml_item_travas where dono_id = a and dono_tipo = 'galeria'),
    'reversão não travou');
end $$;

-- Agregação.
do $$
declare
  o uuid := '97700000-0000-0000-0000-000000000001';
  f uuid := current_setting('teste.f7')::uuid; an uuid := current_setting('teste.an7')::uuid;
  r uuid := current_setting('teste.r7')::uuid;
  a uuid; s text; g uuid := gen_random_uuid(); m uuid := gen_random_uuid(); p uuid := gen_random_uuid();
begin
  -- revertendo: P compensado + G reversao_incompleta → reversao_incompleta (travas soltas).
  a := pg_temp.aplicacao(o, an, f, r, array['MLB-A1P', 'MLB-A1G'], 'revertendo');
  perform public.ml_travar_itens(o, array['MLB-A1P', 'MLB-A1G'], 'galeria', a, null);
  update public.galeria_aplicacao_itens set status = 'compensado' where id = pg_temp.item(a, 'MLB-A1P');
  perform pg_temp.rodando(a, 'MLB-A1G', 'compensando', g);
  s := public.galeria_concluir_item(pg_temp.item(a, 'MLB-A1G'), g, 'reversao_incompleta', '{"erro":"divergiu"}');
  perform pg_temp.afirmar(s = 'reversao_incompleta' and not exists (select 1 from public.ml_item_travas where dono_id = a),
    'compensado + incompleta: ' || s);
  -- revertendo: P compensado + G pulado → revertida.
  a := pg_temp.aplicacao(o, an, f, r, array['MLB-A2P', 'MLB-A2G'], 'revertendo');
  update public.galeria_aplicacao_itens set status = 'compensado' where id = pg_temp.item(a, 'MLB-A2P');
  perform pg_temp.rodando(a, 'MLB-A2G', 'compensando', g);
  s := public.galeria_concluir_item(pg_temp.item(a, 'MLB-A2G'), g, 'pulado', '{}');
  perform pg_temp.afirmar(s = 'revertida', 'compensado + pulado: ' || s);
  -- em_andamento: só falhou/pulado → falhou (o falhou dispara o aborto antes).
  a := pg_temp.aplicacao(o, an, f, r, array['MLB-A3P', 'MLB-A3G'], 'em_andamento');
  update public.galeria_aplicacao_itens set status = 'pulado' where id = pg_temp.item(a, 'MLB-A3P');
  perform pg_temp.rodando(a, 'MLB-A3G', 'aplicando', g);
  s := public.galeria_concluir_item(pg_temp.item(a, 'MLB-A3G'), g, 'falhou', '{}');
  perform pg_temp.afirmar(s = 'falhou', 'só falhou/pulado: ' || s);
  -- abortando: aplicado não fecha a aplicação.
  a := pg_temp.aplicacao(o, an, f, r, array['MLB-A4P', 'MLB-A4G'], 'abortando');
  update public.galeria_aplicacao_itens set status = 'compensado' where id = pg_temp.item(a, 'MLB-A4G');
  perform pg_temp.rodando(a, 'MLB-A4P', 'aplicando', p);
  s := public.galeria_concluir_item(pg_temp.item(a, 'MLB-A4P'), p, 'aplicado', '{}');
  perform pg_temp.afirmar(s = 'abortando', 'aplicado em abortando fechou: ' || s);
  -- em_andamento: G reversao_incompleta dispara o aborto (P aplicado → compensando); M pulado; P compensado
  -- → reversao_incompleta.
  a := pg_temp.aplicacao(o, an, f, r, array['MLB-A5P', 'MLB-A5M', 'MLB-A5G'], 'em_andamento');
  update public.galeria_aplicacao_itens set status = 'aplicado' where id = pg_temp.item(a, 'MLB-A5P');
  perform pg_temp.rodando(a, 'MLB-A5M', 'aplicando', m);
  perform pg_temp.rodando(a, 'MLB-A5G', 'aplicando', g);
  s := public.galeria_concluir_item(pg_temp.item(a, 'MLB-A5G'), g, 'reversao_incompleta', '{}');
  perform pg_temp.afirmar(s = 'abortando' and (select status = 'compensando' and compensar_ate = now() + interval '60 minutes'
    from public.galeria_aplicacao_itens where id = pg_temp.item(a, 'MLB-A5P')), 'aborto na mesma transação: ' || s);
  perform public.galeria_concluir_item(pg_temp.item(a, 'MLB-A5M'), m, 'pulado', '{}');
  update public.galeria_aplicacao_itens set posse = p where id = pg_temp.item(a, 'MLB-A5P');
  s := public.galeria_concluir_item(pg_temp.item(a, 'MLB-A5P'), p, 'compensado', '{}');
  perform pg_temp.afirmar(s = 'reversao_incompleta', 'P compensado + M pulado + G incompleta: ' || s);
end $$;

-- ═════════════ 7. Relógio no banco ═════════════
do $$
declare
  o uuid := '97700000-0000-0000-0000-000000000001';
  f uuid := current_setting('teste.f7')::uuid; an uuid := current_setting('teste.an7')::uuid;
  r uuid := current_setting('teste.r7')::uuid;
  a uuid; s text; n int; img1 uuid; img2 uuid; img3 uuid;
  la uuid; lb uuid; fa1 uuid; fb1 uuid; fa3 uuid; posse uuid := gen_random_uuid(); v uuid;
begin
  perform pg_temp.afirmar((select count(*) = 1 from cron.job where jobname = 'galeria-relogio'
    and schedule = '*/5 * * * *' and command like '%galeria_relogio%'), 'cron do relógio ausente');

  -- Aplicada há 3 dias: a reversão abre ciclo novo e o relógio logo depois não a encerra.
  a := pg_temp.aplicacao(o, an, f, r, array['MLB-R1'], 'aplicada');
  update public.galeria_aplicacoes set criado_em = now() - interval '3 days', ciclo_ate = now() - interval '3 days' + interval '3 hours'
   where id = a;
  update public.galeria_aplicacao_itens set status = 'aplicado' where aplicacao_id = a;
  perform pg_temp.afirmar(public.galeria_iniciar_reversao(o, f, a) = 'ok', 'reversão tardia negada');
  perform public.galeria_relogio();
  perform pg_temp.afirmar((select status = 'revertendo' and ciclo_ate = now() + interval '3 hours'
    from public.galeria_aplicacoes where id = a), 'relógio encerrou reversão recém-aberta');
  perform pg_temp.afirmar((select dono_tipo = 'galeria' from public.ml_item_travas where org_id = o and item_id = 'MLB-R1'),
    'trava galeria expirou');

  -- Ciclo vencido com um item em lease vigente → não encerra; sem lease → reversao_incompleta, travas soltas
  -- (item com PUT há 5 min vira quarentena).
  a := pg_temp.aplicacao(o, an, f, r, array['MLB-R2', 'MLB-R3'], 'preparada');
  perform pg_temp.afirmar(public.galeria_confirmar_aplicacao(o, f, a, r, 'h1') = 'ok', 'confirmar R2');
  update public.galeria_aplicacoes set ciclo_ate = now() - interval '1 minute' where id = a;
  update public.galeria_aplicacao_itens set status = 'aplicando', posse = gen_random_uuid(), lease_ate = now() + interval '1 minute',
    put_em = now() - interval '5 minutes' where id = pg_temp.item(a, 'MLB-R2');
  -- Claim depois do ciclo (inclusive de mensagem antiga) afeta 0 linhas.
  update public.galeria_aplicacao_itens i set posse = gen_random_uuid(), lease_ate = now() + interval '150 seconds'
   where i.id = pg_temp.item(a, 'MLB-R3') and (i.lease_ate is null or i.lease_ate < now())
     and exists (select 1 from public.galeria_aplicacoes x where x.id = i.aplicacao_id and x.ciclo_ate > now());
  get diagnostics n = row_count;
  perform pg_temp.afirmar(n = 0, 'claim depois do ciclo');
  perform public.galeria_relogio();
  perform pg_temp.afirmar((select status = 'em_andamento' from public.galeria_aplicacoes where id = a),
    'relógio encerrou com lease vigente');
  update public.galeria_aplicacao_itens set lease_ate = now() - interval '1 second' where id = pg_temp.item(a, 'MLB-R2');
  perform public.galeria_relogio();
  perform pg_temp.afirmar((select status = 'reversao_incompleta' from public.galeria_aplicacoes where id = a)
    and (select bool_and(status = 'reversao_incompleta') from public.galeria_aplicacao_itens where aplicacao_id = a),
    'relógio não encerrou');
  perform pg_temp.afirmar((select dono_tipo = 'quarentena' and expira_em = now() + interval '10 minutes'
    from public.ml_item_travas where org_id = o and item_id = 'MLB-R2')
    and not exists (select 1 from public.ml_item_travas where org_id = o and item_id = 'MLB-R3'),
    'relógio não soltou com quarentena');
  perform pg_temp.afirmar(not public.ml_travar_itens(o, array['MLB-R2'], 'escritor', gen_random_uuid(), 600),
    'escritor travou na quarentena do relógio');
  -- Repetida depois de soltar → em_andamento.
  a := pg_temp.aplicacao(o, an, f, r, array['MLB-R3'], 'preparada');
  perform pg_temp.afirmar(public.galeria_confirmar_aplicacao(o, f, a, r, 'h1') = 'ok', 'nova aplicação depois de soltar');
  perform pg_temp.afirmar((select status = 'em_andamento' from public.galeria_aplicacoes where id = a),
    'nova aplicação não ficou em_andamento');

  -- Falhas repetidas depois do claim em 3 itens: encerra no primeiro tick depois do último lease vencer.
  a := pg_temp.aplicacao(o, an, f, r, array['MLB-R4', 'MLB-R5', 'MLB-R6'], 'preparada');
  perform pg_temp.afirmar(public.galeria_confirmar_aplicacao(o, f, a, r, 'h1') = 'ok', 'confirmar R4');
  update public.galeria_aplicacoes set ciclo_ate = now() - interval '10 minutes' where id = a;
  update public.galeria_aplicacao_itens set status = 'subindo', posse = gen_random_uuid(),
    lease_ate = now() - (case item_id when 'MLB-R4' then 120 when 'MLB-R5' then 60 else 1 end) * interval '1 second'
   where aplicacao_id = a;
  perform public.galeria_relogio();
  perform pg_temp.afirmar((select status = 'reversao_incompleta' from public.galeria_aplicacoes where id = a)
    and not exists (select 1 from public.ml_item_travas where dono_id = a), 'relógio não encerrou após os leases');

  -- Imagem órfã há 60 min (lease nulo/vencido) → falhou/expirada, sem cobrança; com lease ou recente → intacta.
  img1 := pg_temp.uma(o, an, f, r, 50, current_setting('teste.t1')::uuid, true, 'Laranja', 1);
  img2 := pg_temp.uma(o, an, f, r, 50, current_setting('teste.t1')::uuid, true, 'Laranja', 2);
  img3 := pg_temp.uma(o, an, f, r, 50, current_setting('teste.t1')::uuid, true, 'Laranja', 3);
  update public.galeria_imagens set criado_em = now() - interval '61 minutes' where id in (img1, img2);
  update public.galeria_imagens set status = 'gerando', lease_ate = now() + interval '1 minute' where id = img2;
  update public.galeria_imagens set criado_em = now() - interval '30 minutes' where id = img3;
  perform public.galeria_relogio();
  perform pg_temp.afirmar((select status = 'falhou' and erro = 'expirada' from public.galeria_imagens where id = img1),
    'imagem órfã não expirou');
  perform pg_temp.afirmar((select status = 'gerando' from public.galeria_imagens where id = img2)
    and (select status = 'pendente' from public.galeria_imagens where id = img3), 'relógio expirou imagem viva');
  perform pg_temp.afirmar(not exists (select 1 from public.platform_image_deliveries d join public.galeria_imagens g
    on g.request_id = d.request_id where g.id = img1), 'imagem expirada cobrada');

  -- Escrita adiada órfã (260 min): família publicando → erro, lote recalculado, linha apagada, variacoes intactas.
  la := pg_temp.lote(o, 'publicando');
  fa1 := pg_temp.familia(o, la, '09778001', 'publicando');
  insert into public.variacoes (familia_id, user_id, codigo, preco, org_id, ml_picture_id)
  values (fa1, pg_temp.u(o), '09778011', 10, o, 'PIC-1') returning id into v;
  lb := pg_temp.lote(o, 'concluido');
  fb1 := pg_temp.familia(o, lb, '09778002', 'publicado');
  update public.familias set erro_mensagem = null where id = fb1;
  fa3 := pg_temp.familia(o, la, '09778003', 'erro');
  insert into public.ml_escritas_adiadas (org_id, familia_id, lote_id, endpoint, itens, job, adiado_desde, posse, assumida_ate)
  values (o, fa1, la, 'update-familia-ml', array['MLB-W1'], '{}', now() - interval '261 minutes', null, null),
         (o, fb1, lb, 'update-familia-ml', array['MLB-W2'], '{}', now() - interval '261 minutes', null, null),
         (o, fa3, la, 'e-assumida', array['MLB-W3'], '{}', now() - interval '261 minutes', gen_random_uuid(), now() + interval '5 minutes'),
         (o, fa3, la, 'e-travada', array['MLB-W4'], '{}', now() - interval '261 minutes', posse, null),
         (o, fa3, la, 'e-recente', array['MLB-W5'], '{}', now() - interval '200 minutes', null, null);
  insert into public.ml_item_travas (org_id, item_id, dono_tipo, dono_id, expira_em)
  values (o, 'MLB-W4', 'escritor', posse, now() + interval '5 minutes');
  perform public.galeria_relogio();
  perform pg_temp.afirmar((select status = 'erro' and erro_mensagem = 'item_reservado_galeria' from public.familias where id = fa1),
    'família publicando não virou erro');
  perform pg_temp.afirmar((select status = 'revisao' from public.lotes where id = la), 'lote não recalculado');
  perform pg_temp.afirmar((select ml_picture_id = 'PIC-1' from public.variacoes where id = v), 'relógio tocou em variacoes');
  perform pg_temp.afirmar((select status = 'publicado' and erro_mensagem is null from public.familias where id = fb1),
    'família já publicada mudou');
  perform pg_temp.afirmar((select status = 'concluido' from public.lotes where id = lb), 'lote da publicada mudou');
  perform pg_temp.afirmar(not exists (select 1 from public.ml_escritas_adiadas where familia_id in (fa1, fb1)),
    'linhas órfãs não apagadas');
  perform pg_temp.afirmar((select count(*) = 3 from public.ml_escritas_adiadas where familia_id = fa3),
    'relógio apagou escrita assumida/travada/recente');
end $$;

-- Paridade lote_decidir_status × decidirStatusLote (casos de _shared/lote/__tests__/finalizar.test.ts).
do $$
declare
  o uuid := '97700000-0000-0000-0000-000000000001';
  c record; l uuid; st text; k int := 0;
begin
  for c in select * from (values
      (array['publicando'], null::text),
      (array['pronto', 'pronto'], 'revisao'),
      (array['pendente'], 'processando'),
      (array['pronto', 'pendente'], 'revisao'),
      (array['erro'], 'revisao'),
      (array['publicado', 'erro'], 'concluido'),
      (array[]::text[], 'concluido')) as t(estados, esperado) loop
    l := pg_temp.lote(o);
    foreach st in array c.estados loop
      k := k + 1;
      perform pg_temp.familia(o, l, '0977900' || k, st);
    end loop;
    perform pg_temp.afirmar(public.lote_decidir_status(l) is not distinct from c.esperado,
      'paridade ' || array_to_string(c.estados, ',') || ': ' || coalesce(public.lote_decidir_status(l), 'null'));
  end loop;
end $$;

-- ═════════════ 8. Privilégios ═════════════
do $$
declare fn text;
begin
  foreach fn in array array['public.ml_travar_itens(uuid,text[],text,uuid,integer)', 'public.ml_estender_trava(uuid,text[],uuid,integer)',
    'public.ml_soltar_itens(uuid,uuid)', 'public.galeria_confirmar_aplicacao(uuid,uuid,uuid,uuid,text)',
    'public.galeria_iniciar_reversao(uuid,uuid,uuid)', 'public.galeria_concluir_item(uuid,uuid,text,jsonb)',
    'public.galeria_reservar_pedido(jsonb)', 'public.galeria_registrar_entrega(uuid)',
    'public.galeria_confirmar_exibicao(uuid,uuid,uuid[])', 'public.platform_imagem_competencia(uuid)',
    'public.lote_decidir_status(uuid)', 'public.galeria_relogio()', 'public.galeria_soltar_travas(uuid,uuid)',
    'public.galeria_agregar_aplicacao(uuid)', 'public.galeria_itens_da_aplicacao(uuid)'] loop
    perform pg_temp.afirmar(not has_function_privilege('authenticated', fn, 'execute')
      and not has_function_privilege('anon', fn, 'execute'), 'authenticated/anon executa ' || fn);
  end loop;
  perform pg_temp.afirmar(has_function_privilege('service_role', 'public.galeria_confirmar_exibicao(uuid,uuid,uuid[])', 'execute'),
    'service_role sem execute');
  perform pg_temp.afirmar(has_table_privilege('authenticated', 'public.galeria_imagens', 'select')
    and not has_table_privilege('authenticated', 'public.galeria_imagens', 'insert')
    and not has_table_privilege('authenticated', 'public.ml_item_travas', 'update')
    and not has_table_privilege('authenticated', 'public.galeria_cursores', 'select'), 'privilégios de tabela');
end $$;

-- ═════════════ 9. Storage: galeria-ia imutável para o usuário ═════════════
insert into storage.objects (bucket_id, name) values
  ('imagens', '97700000-0000-0000-0000-000000000001/galeria-ia/f/referencias/r.jpg'),
  ('imagens', '97700000-0000-0000-0000-000000000001/galeria-ia/f/cenas/c.jpg'),
  ('imagens', '97700000-0000-0000-0000-000000000001/galeria-ia/f/finais/x.jpg'),
  ('imagens', '97700000-0000-0000-0000-000000000001/outra-pasta/a.jpg'),
  ('imagens', '97700000-0000-0000-0000-000000000001/outra-pasta/b.jpg');
select set_config('request.jwt.claims', '{"sub":"97700000-0000-0000-0000-000000000101","role":"authenticated"}', true);
select set_config('storage.allow_delete_query', 'true', true);
set local role authenticated;
do $$
declare p text; n int; o text := '97700000-0000-0000-0000-000000000001';
begin
  foreach p in array array['referencias/r.jpg', 'cenas/c.jpg', 'finais/x.jpg'] loop
    begin
      insert into storage.objects (bucket_id, name) values ('imagens', o || '/galeria-ia/f/' || p || '.novo');
      raise exception 'FALHA: insert em galeria-ia/% aceito', p;
    exception when insufficient_privilege then null;
    end;
    update storage.objects set metadata = '{"x":1}' where bucket_id = 'imagens' and name = o || '/galeria-ia/f/' || p;
    get diagnostics n = row_count;
    perform pg_temp.afirmar(n = 0, 'update em galeria-ia/' || p);
    delete from storage.objects where bucket_id = 'imagens' and name = o || '/galeria-ia/f/' || p;
    get diagnostics n = row_count;
    perform pg_temp.afirmar(n = 0, 'delete em galeria-ia/' || p);
  end loop;
  begin
    update storage.objects set name = o || '/galeria-ia/f/cenas/movido.jpg' where bucket_id = 'imagens' and name = o || '/outra-pasta/b.jpg';
    raise exception 'FALHA: renomear para galeria-ia aceito';
  exception when insufficient_privilege then null;
  end;
  insert into storage.objects (bucket_id, name) values ('imagens', o || '/outra-pasta/novo.jpg');
  update storage.objects set metadata = '{"x":1}' where bucket_id = 'imagens' and name = o || '/outra-pasta/a.jpg';
  get diagnostics n = row_count;
  perform pg_temp.afirmar(n = 1, 'update em outra-pasta negado');
  delete from storage.objects where bucket_id = 'imagens' and name = o || '/outra-pasta/a.jpg';
  get diagnostics n = row_count;
  perform pg_temp.afirmar(n = 1, 'delete em outra-pasta negado');
  perform pg_temp.afirmar((select count(*) = 3 from storage.objects where bucket_id = 'imagens' and name like o || '/galeria-ia/%'),
    'leitura de galeria-ia mudou');
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ═════════════ 10. Kit: mesmas entregas antes e depois da migration ═════════════
-- Mesmos cenários com o gatilho da migration e com o corpo de 20261108094500 (recriado só nesta transação):
-- org com módulo e termos (80), org sem módulo e org com o mês corrente fechado.
create or replace function pg_temp.kit_rodada() returns jsonb language plpgsql as $$
declare o uuid; r uuid; res jsonb := '[]'::jsonb;
begin
  foreach o in array array['97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-000000000002',
    '97700000-0000-0000-0000-000000000003']::uuid[] loop
    r := gen_random_uuid();
    insert into public.kit_variacao_imagens (org_id, request_id, status, familia_base_id, cores, rotulo, modelo, storage_path, custo_usd)
    values (o, r, 'gerada', gen_random_uuid(), array['Preto','Branco'], 'Preto e Branco', 'google/gemini-nano-banana-2.1',
      o || '/kit-variacao-ia/' || r || '.png', 0.041);
    res := res || (select jsonb_build_object('org', d.org_id, 'terms', d.terms_id, 'mes', d.month - pg_temp.mes(),
      'unit', d.unit_cents, 'units', d.units, 'total', d.total_cents, 'custo', d.cost_usd, 'reason', d.reason, 'origem', d.origem)
      from public.platform_image_deliveries d where d.org_id = o and d.request_id = r);
  end loop;
  return res;
end $$;
do $$
declare novo jsonb; antigo jsonb;
begin
  update public.organizations set modulos_habilitados = array['kit_variacao', 'imagem_ia']
   where id in ('97700000-0000-0000-0000-000000000001', '97700000-0000-0000-0000-000000000003');
  update public.organizations set modulos_habilitados = array['kit_variacao'] where id = '97700000-0000-0000-0000-000000000002';
  novo := pg_temp.kit_rodada();
  perform pg_temp.afirmar(jsonb_array_length(novo) = 3 and (select bool_and(e->>'origem' = 'kit_variacao') from jsonb_array_elements(novo) e),
    'kit sem origem kit_variacao: ' || novo::text);
  perform pg_temp.afirmar(novo->0->>'unit' = '80' and novo->0->>'units' = '1' and novo->1->>'reason' = 'modulo_desligado'
    and (novo->2->>'mes')::int > 0, 'kit com preço/competência errados: ' || novo::text);
  perform set_config('teste.kit_novo', novo::text, true);
end $$;
create or replace function public.platform_image_delivery_on_generated() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_month date;
declare v_terms public.platform_commercial_terms%rowtype;
declare v_modulo boolean;
declare v_units smallint;
begin
  select 'imagem_ia' = any(o.modulos_habilitados) into v_modulo
    from public.organizations o where o.id = new.org_id for no key update;
  v_month := date_trunc('month', clock_timestamp() at time zone 'America/Fortaleza')::date;
  while exists (select 1 from public.platform_billing_statements s where s.org_id = new.org_id and s.month = v_month) loop
    v_month := (v_month + interval '1 month')::date;
  end loop;
  select * into v_terms from public.platform_resolve_terms(new.org_id, v_month);
  v_units := case when coalesce(v_modulo, false) and v_terms.id is not null then 1 else 0 end;
  insert into public.platform_image_deliveries (org_id, request_id, terms_id, month, unit_cents, units, total_cents, cost_usd, reason)
  values (new.org_id, new.request_id, v_terms.id, v_month, coalesce(v_terms.image_unit_cents, 0), v_units,
    coalesce(v_terms.image_unit_cents, 0) * v_units, new.custo_usd,
    case when not coalesce(v_modulo, false) then 'modulo_desligado'
      when v_terms.id is null then 'sem_condicao_comercial' end)
  on conflict (org_id, request_id) do nothing;
  return null;
end;
$$;
do $$
declare antigo jsonb;
begin
  antigo := pg_temp.kit_rodada();
  perform pg_temp.afirmar(antigo = current_setting('teste.kit_novo')::jsonb,
    'kit mudou com a migration: antes ' || antigo::text || ' depois ' || current_setting('teste.kit_novo'));
end $$;

rollback;
