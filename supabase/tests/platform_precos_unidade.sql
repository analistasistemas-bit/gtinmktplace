\set ON_ERROR_STOP on
-- Emenda 2026-11-08 ao ADR-0155: preços por unidade com vigência na competência aberta.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/platform_precos_unidade.sql \
--          supabase/migrations/20261108141425_platform_precos_unidade_vigencia_atual.sql
-- Só toca dados do próprio fixture (orgs is_test, usuário, termos, entregas, demonstrativo); tudo some no rollback.
begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97700000-0000-0000-0000-000000000001', 'Preço unidade M2', 'preco-unidade-m2-teste', array['pulse','kit_variacao','imagem_ia'], true),
  ('97700000-0000-0000-0000-000000000002', 'Preço unidade M1', 'preco-unidade-m1-teste', array['pulse','kit_variacao','imagem_ia'], true),
  ('97700000-0000-0000-0000-000000000003', 'Preço unidade fechado', 'preco-unidade-fechado-teste', array['pulse','kit_variacao','imagem_ia'], true),
  ('97700000-0000-0000-0000-000000000004', 'Preço unidade sem termo', 'preco-unidade-sem-termo-teste', array['pulse'], true),
  ('97700000-0000-0000-0000-000000000005', 'Preço unidade setup vencido', 'preco-unidade-setup-vencido-teste', array['pulse'], true);
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('97700000-0000-0000-0000-000000000101', 'admin-preco-unidade@teste.local', '{}'::jsonb,
   '{"org_id":"97700000-0000-0000-0000-000000000001"}'::jsonb),
  ('97700000-0000-0000-0000-000000000102', 'cliente-preco-unidade@teste.local', '{}'::jsonb,
   '{"org_id":"97700000-0000-0000-0000-000000000001"}'::jsonb);
update public.profiles set is_super_admin = true, org_id = null, is_active = true where id = '97700000-0000-0000-0000-000000000101';
update public.profiles set is_super_admin = false, is_active = true where id = '97700000-0000-0000-0000-000000000102';

-- Termos do fixture gravados direto (começam no mês passado, como um contrato já em curso).
insert into public.platform_commercial_terms (org_id, starts_on, modality, monthly_fee_cents,
  revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4, sonar_unit_cents, image_unit_cents,
  setup_fee_cents, setup_due_month, reason, created_by, version, due_day)
select o, (date_trunc('month', now() at time zone 'America/Fortaleza') - interval '1 month')::date, m, fee,
  700, 600, 550, 500, sonar, img, setup, due, 'fixture preço unidade', '97700000-0000-0000-0000-000000000101', 1, 12
from (values
  ('97700000-0000-0000-0000-000000000001'::uuid, 2::smallint, 0::bigint, 100::bigint, 50::bigint, 300000::bigint,
   date_trunc('month', now() at time zone 'America/Fortaleza')::date),
  ('97700000-0000-0000-0000-000000000002'::uuid, 1::smallint, 60000::bigint, 0::bigint, 40::bigint, 0::bigint, null::date),
  ('97700000-0000-0000-0000-000000000003'::uuid, 2::smallint, 0::bigint, 100::bigint, 50::bigint, 0::bigint, null::date),
  ('97700000-0000-0000-0000-000000000005'::uuid, 1::smallint, 60000::bigint, 0::bigint, 0::bigint, 300000::bigint,
   (date_trunc('month', now() at time zone 'America/Fortaleza') - interval '1 month')::date)
) as f(o, m, fee, sonar, img, setup, due);

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;

create or replace function pg_temp.imagem(o uuid, r uuid) returns void language sql as $$
  insert into public.kit_variacao_imagens (org_id, request_id, status, familia_base_id, cores, rotulo, modelo, storage_path, custo_usd)
  values (o, r, 'gerada', gen_random_uuid(), array['Preto','Branco'], 'Preto e Branco', 'google/gemini-nano-banana-2.1',
    o || '/kit-variacao-ia/' || r || '.png', 0.041)
$$;

-- Uma consulta Sonar concluída por um cliente: resultado pronto + busca + entrega (a função real de entrega).
create or replace function pg_temp.sonar(o uuid) returns public.platform_sonar_deliveries language plpgsql as $$
declare r uuid; s public.platform_sonar_searches%rowtype; q text := 'teste-preco-unidade-' || gen_random_uuid(); d jsonb;
declare e public.platform_sonar_deliveries%rowtype;
begin
  insert into public.platform_sonar_results (normalized_query, query_type, schema_version, generation, payload, state, valid_until)
    values (q, 'termo', 1, 1, '{"itens":[1]}'::jsonb, 'ready', now() + interval '7 days') returning id into r;
  insert into public.platform_sonar_searches (org_id, actor_id, request_id, intent_key, normalized_query, query_type, result_id, state, origin)
    values (o, '97700000-0000-0000-0000-000000000102', gen_random_uuid(), 'query:termo:1:' || q, q, 'termo', r, 'completed', 'cliente')
    returning * into s;
  d := public.platform_sonar_delivery_json(s);
  select * into e from public.platform_sonar_deliveries where id = (d->>'entrega_id')::uuid;
  return e;
end $$;

do $$
declare
  ator uuid := '97700000-0000-0000-0000-000000000101';
  cliente uuid := '97700000-0000-0000-0000-000000000102';
  m2 uuid := '97700000-0000-0000-0000-000000000001';
  m1 uuid := '97700000-0000-0000-0000-000000000002';
  fx uuid := '97700000-0000-0000-0000-000000000003';
  sem uuid := '97700000-0000-0000-0000-000000000004';
  venc uuid := '97700000-0000-0000-0000-000000000005';
  mes date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  passado date := (date_trunc('month', now() at time zone 'America/Fortaleza') - interval '1 month')::date;
  antigo public.platform_commercial_terms%rowtype;
  novo jsonb;
  s1 public.platform_sonar_deliveries%rowtype;
  s2 public.platform_sonar_deliveries%rowtype;
  s3 public.platform_sonar_deliveries%rowtype;
  i1 uuid := gen_random_uuid();
  i2 uuid := gen_random_uuid();
  ev public.platform_audit_events%rowtype;
  antes jsonb;
  depois jsonb;
  linha jsonb;
begin
  perform pg_temp.afirmar((select is_super_admin from public.profiles where id = ator), 'fixture: super-admin não criado');
  select * into antigo from public.platform_commercial_terms where org_id = m2;
  antes := public.platform_billing_preview(ator, m2, mes);

  -- Entregas ANTES da troca: preço antigo (Sonar 1,00; imagem 0,50).
  s1 := pg_temp.sonar(m2);
  perform pg_temp.imagem(m2, i1);
  perform pg_temp.afirmar(s1.unit_cents = 100 and s1.units = 1 and s1.month = mes and s1.terms_id = antigo.id, 'Sonar antes da troca: ' || to_jsonb(s1)::text);
  perform pg_temp.afirmar((select unit_cents from public.platform_image_deliveries where org_id = m2 and request_id = i1) = 50, 'imagem antes da troca');

  -- Só super-admin ativo.
  begin
    perform public.platform_save_unit_prices(cliente, jsonb_build_object('org_id', m2, 'expected_terms_id', (public.platform_resolve_terms(m2, mes)).id, 'sonar_unit_cents', 150, 'image_unit_cents', 80));
    raise exception 'FALHA: cliente alterou preço';
  exception when insufficient_privilege then null;
  end;
  -- Entrada inválida.
  begin
    perform public.platform_save_unit_prices(ator, jsonb_build_object('org_id', m2, 'expected_terms_id', (public.platform_resolve_terms(m2, mes)).id, 'sonar_unit_cents', -1, 'image_unit_cents', 80));
    raise exception 'FALHA: preço negativo aceito';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.platform_save_unit_prices(ator, jsonb_build_object('org_id', m2, 'expected_terms_id', (public.platform_resolve_terms(m2, mes)).id, 'sonar_unit_cents', '150', 'image_unit_cents', 80));
    raise exception 'FALHA: preço em texto aceito';
  exception when invalid_parameter_value then null;
  end;
  -- Formulário desatualizado: termo-base diferente do vigente.
  begin
    perform public.platform_save_unit_prices(ator, jsonb_build_object('org_id', m2, 'expected_terms_id', gen_random_uuid(),
      'sonar_unit_cents', 150, 'image_unit_cents', 80));
    raise exception 'FALHA: termo-base desatualizado aceito';
  exception when serialization_failure then null;
  end;
  begin
    perform public.platform_save_unit_prices(ator, jsonb_build_object('org_id', m2, 'sonar_unit_cents', 150, 'image_unit_cents', 80));
    raise exception 'FALHA: sem termo-base aceito';
  exception when invalid_parameter_value then null;
  end;
  -- Nada mudou.
  begin
    perform public.platform_save_unit_prices(ator, jsonb_build_object('org_id', m2, 'expected_terms_id', (public.platform_resolve_terms(m2, mes)).id, 'sonar_unit_cents', 100, 'image_unit_cents', 50));
    raise exception 'FALHA: troca sem mudança aceita';
  exception when invalid_parameter_value then null;
  end;

  -- A troca.
  novo := public.platform_save_unit_prices(ator, jsonb_build_object('org_id', m2, 'expected_terms_id', (public.platform_resolve_terms(m2, mes)).id, 'sonar_unit_cents', 150, 'image_unit_cents', 80));
  perform pg_temp.afirmar((novo->>'starts_on')::date = mes and (novo->>'version')::int = 1, 'vigência na competência aberta: ' || novo::text);
  perform pg_temp.afirmar((novo->>'sonar_unit_cents')::bigint = 150 and (novo->>'image_unit_cents')::bigint = 80, 'preços novos');
  -- Mensalidade, faixas, implantação, vencimento e modalidade não mudam.
  perform pg_temp.afirmar((novo->>'modality')::int = antigo.modality
    and (novo->>'monthly_fee_cents')::bigint = antigo.monthly_fee_cents
    and (novo->>'revenue_bps_t1')::int = antigo.revenue_bps_t1 and (novo->>'revenue_bps_t2')::int = antigo.revenue_bps_t2
    and (novo->>'revenue_bps_t3')::int = antigo.revenue_bps_t3 and (novo->>'revenue_bps_t4')::int = antigo.revenue_bps_t4
    and (novo->>'due_day')::int = antigo.due_day
    and (novo->>'setup_fee_cents')::bigint = 300000 and (novo->>'setup_due_month')::date = mes, 'campos copiados: ' || novo::text);
  perform pg_temp.afirmar((select count(*) from public.platform_commercial_terms where org_id = m2) = 2, 'termo antigo preservado');
  -- Auditoria: quem, quando, de/para.
  select * into ev from public.platform_audit_events where org_id = m2 and action = 'platform_unit_prices_saved';
  perform pg_temp.afirmar(ev.actor_id = ator and ev.occurred_at is not null and ev.target = novo->>'id'
    and ev.details->'sonar_unit_cents' = '{"de":100,"para":150}'::jsonb
    and ev.details->'image_unit_cents' = '{"de":50,"para":80}'::jsonb
    and (ev.details->>'previous_terms_id')::uuid = antigo.id, 'auditoria: ' || to_jsonb(ev)::text);

  -- Entregas DEPOIS: preço novo; as anteriores ficam com o antigo.
  s2 := pg_temp.sonar(m2);
  perform pg_temp.imagem(m2, i2);
  perform pg_temp.afirmar(s2.unit_cents = 150 and s2.total_cents = 150 and s2.terms_id = (novo->>'id')::uuid, 'Sonar depois da troca: ' || to_jsonb(s2)::text);
  perform pg_temp.afirmar((select unit_cents from public.platform_image_deliveries where org_id = m2 and request_id = i2) = 80, 'imagem depois da troca');
  perform pg_temp.afirmar((select unit_cents from public.platform_sonar_deliveries where id = s1.id) = 100, 'Sonar anterior recalculado');
  perform pg_temp.afirmar((select unit_cents from public.platform_image_deliveries where org_id = m2 and request_id = i1) = 50, 'imagem anterior recalculada');

  -- Prévia soma pelo unit_cents gravado; mensalidade, faixa e implantação iguais.
  depois := public.platform_billing_preview(ator, m2, mes);
  perform pg_temp.afirmar((depois->>'sonar_cents')::bigint = 250 and (depois->>'sonar_units')::int = 2, 'Sonar na prévia: ' || (depois->>'sonar_cents'));
  perform pg_temp.afirmar((depois->>'image_cents')::bigint = 130 and (depois->>'image_units')::int = 2, 'imagem na prévia');
  perform pg_temp.afirmar(depois->>'fee_cents' = antes->>'fee_cents' and depois->>'applied_bps' = antes->>'applied_bps', 'remuneração mudou');
  select l into linha from jsonb_array_elements(depois->'lines') l where l->>'key' = 'setup';
  perform pg_temp.afirmar((linha->>'amount_cents')::bigint = 300000, 'implantação sumiu da prévia (ADR-0164)');
  select l into linha from jsonb_array_elements(depois->'lines') l where l->>'key' = 'infrastructure';
  perform pg_temp.afirmar((linha->>'amount_cents')::bigint = 0, 'infraestrutura mudou');
  select l into linha from jsonb_array_elements(depois->'lines') l where l->>'key' = 'sonar';
  perform pg_temp.afirmar(linha->'unit_cents' = 'null'::jsonb and (linha->>'amount_cents')::bigint = 250, 'linha Sonar com dois preços: ' || linha::text);
  select l into linha from jsonb_array_elements(depois->'lines') l where l->>'key' = 'image_ia';
  perform pg_temp.afirmar(linha->'unit_cents' = 'null'::jsonb and (linha->>'amount_cents')::bigint = 130, 'linha imagem com dois preços: ' || linha::text);

  -- Segunda troca no mesmo mês: version 2 do mesmo starts_on, implantação ainda viva.
  novo := public.platform_save_unit_prices(ator, jsonb_build_object('org_id', m2, 'expected_terms_id', (public.platform_resolve_terms(m2, mes)).id, 'sonar_unit_cents', 150, 'image_unit_cents', 90, 'reason', 'ajuste'));
  perform pg_temp.afirmar((novo->>'version')::int = 2 and (novo->>'setup_fee_cents')::bigint = 300000 and novo->>'reason' = 'ajuste', 'segunda troca: ' || novo::text);

  -- Renegociação seguinte (próximo mês) herda a implantação desta versão como antes (ADR-0164), sem quebrar.
  perform public.platform_save_terms(ator, jsonb_build_object(
    'org_id', m2, 'starts_on', (mes + interval '1 month')::date, 'modality', 2, 'monthly_fee_cents', 0,
    'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
    'sonar_unit_cents', 150, 'image_unit_cents', 90, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'reneg'));
  perform pg_temp.afirmar((select (l->>'amount_cents')::bigint from jsonb_array_elements(public.platform_billing_preview(ator, m2, mes)->'lines') l
    where l->>'key' = 'setup') = 300000, 'implantação sumiu depois da renegociação');

  -- Modalidade 1: Sonar só 0; Imagem editável.
  begin
    perform public.platform_save_unit_prices(ator, jsonb_build_object('org_id', m1, 'expected_terms_id', (public.platform_resolve_terms(m1, mes)).id, 'sonar_unit_cents', 10, 'image_unit_cents', 40));
    raise exception 'FALHA: modalidade 1 aceitou Sonar';
  exception when invalid_parameter_value then null;
  end;
  novo := public.platform_save_unit_prices(ator, jsonb_build_object('org_id', m1, 'expected_terms_id', (public.platform_resolve_terms(m1, mes)).id, 'sonar_unit_cents', 0, 'image_unit_cents', 70));
  perform pg_temp.afirmar((novo->>'sonar_unit_cents')::bigint = 0 and (novo->>'image_unit_cents')::bigint = 70
    and (novo->>'monthly_fee_cents')::bigint = 60000 and (novo->>'modality')::int = 1, 'modalidade 1, imagem: ' || novo::text);

  -- Competência aberta com demonstrativo fechado: recusa. E a entrega do Sonar vai para a seguinte aberta.
  insert into public.platform_billing_statements (org_id, month, terms_id, revenue_bps, gross_cents, refund_cents,
    base_cents, fee_cents, sonar_cents, credit_cents, total_cents, revision, snapshot, closed_by)
  select fx, mes, id, 700, 0, 0, 0, 0, 0, 0, 0, 'teste', '{}'::jsonb, ator from public.platform_commercial_terms where org_id = fx;
  begin
    perform public.platform_save_unit_prices(ator, jsonb_build_object('org_id', fx, 'expected_terms_id', (public.platform_resolve_terms(fx, mes)).id, 'sonar_unit_cents', 150, 'image_unit_cents', 80));
    raise exception 'FALHA: mês fechado aceitou troca';
  exception when check_violation then null;
  end;
  perform pg_temp.afirmar((select count(*) from public.platform_commercial_terms where org_id = fx) = 1, 'mês fechado gravou termo');
  s3 := pg_temp.sonar(fx);
  perform pg_temp.afirmar(s3.month = (mes + interval '1 month')::date and s3.units = 1, 'Sonar caiu em competência fechada: ' || to_jsonb(s3)::text);

  -- Sem condição vigente: recusa.
  begin
    perform public.platform_save_unit_prices(ator, jsonb_build_object('org_id', sem, 'expected_terms_id', gen_random_uuid(), 'sonar_unit_cents', 0, 'image_unit_cents', 10));
    raise exception 'FALHA: sem termo aceitou troca';
  exception when check_violation then null;
  end;

  -- Implantação já vencida (mês passado): versão nova zera, e o mês dela continua cobrando pelo termo antigo.
  novo := public.platform_save_unit_prices(ator, jsonb_build_object('org_id', venc, 'expected_terms_id', (public.platform_resolve_terms(venc, mes)).id, 'sonar_unit_cents', 0, 'image_unit_cents', 30));
  perform pg_temp.afirmar((novo->>'setup_fee_cents')::bigint = 0 and novo->'setup_due_month' = 'null'::jsonb, 'setup vencido herdado: ' || novo::text);
  perform pg_temp.afirmar((select (l->>'amount_cents')::bigint from jsonb_array_elements(public.platform_billing_preview(ator, venc, passado)->'lines') l
    where l->>'key' = 'setup') = 300000, 'implantação do mês passado sumiu');
end $$;

rollback;
