\set ON_ERROR_STOP on
-- Task 16 (kit com variação): cobrança por imagem IA, igual ao Sonar.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/platform_imagem_ia.sql <migrations da branch em ordem>
-- Só toca dados do próprio fixture (org, usuário, termos, imagens, demonstrativo); tudo some no rollback.
begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97600000-0000-0000-0000-000000000001', 'Imagem IA cobra', 'imagem-ia-cobra-teste', array['kit_variacao', 'imagem_ia'], true),
  ('97600000-0000-0000-0000-000000000002', 'Imagem IA sem modulo', 'imagem-ia-sem-modulo-teste', array['kit_variacao'], true);
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('97600000-0000-0000-0000-000000000101', 'admin-imagem-ia@teste.local',
   '{}'::jsonb, '{"org_id":"97600000-0000-0000-0000-000000000001"}'::jsonb);
update public.profiles set is_super_admin = true, org_id = null, is_active = true where id = '97600000-0000-0000-0000-000000000101';

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;

create or replace function pg_temp.imagem(o uuid, r uuid, st text) returns void language sql as $$
  insert into public.kit_variacao_imagens (org_id, request_id, status, familia_base_id, cores, rotulo, modelo, storage_path, custo_usd)
  values (o, r, st, gen_random_uuid(), array['Preto','Branco'], 'Preto e Branco', 'google/gemini-nano-banana-2.1',
    case when st in ('gerada','pendente_upload') then o || '/kit-variacao-ia/' || r || '.png' end,
    case when st in ('gerada','pendente_upload','recusada') then 0.041 end)
$$;

do $$
declare
  ator uuid := '97600000-0000-0000-0000-000000000101';
  o uuid := '97600000-0000-0000-0000-000000000001';
  sem uuid := '97600000-0000-0000-0000-000000000002';
  mes date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  passado date := (date_trunc('month', now() at time zone 'America/Fortaleza') - interval '1 month')::date;
  r1 uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  rp uuid := gen_random_uuid();
  termo jsonb;
  prev jsonb;
  linha jsonb;
  fechado jsonb;
  termo_passado uuid;
begin
  perform pg_temp.afirmar((select is_super_admin from public.profiles where id = ator), 'fixture: super-admin não criado');

  -- Tabela só de service_role.
  perform pg_temp.afirmar((select relrowsecurity from pg_class where oid = 'public.platform_image_deliveries'::regclass), 'RLS desligada');
  perform pg_temp.afirmar(not has_table_privilege('authenticated', 'public.platform_image_deliveries', 'select'), 'authenticated lê entregas');
  perform pg_temp.afirmar(not has_table_privilege('anon', 'public.platform_image_deliveries', 'insert'), 'anon grava entregas');

  -- Preço por imagem na condição comercial (absente = 0, inválido recusado).
  termo := public.platform_save_terms(ator, jsonb_build_object(
    'org_id', o, 'starts_on', mes, 'modality', 2, 'monthly_fee_cents', 0,
    'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
    'sonar_unit_cents', 0, 'image_unit_cents', 50, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'teste imagem'));
  perform pg_temp.afirmar((termo->>'image_unit_cents')::bigint = 50, 'image_unit_cents não persistiu');
  begin
    perform public.platform_save_terms(ator, jsonb_build_object(
      'org_id', o, 'starts_on', (mes + interval '1 month')::date, 'modality', 2, 'monthly_fee_cents', 0,
      'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
      'sonar_unit_cents', 0, 'image_unit_cents', -1, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'x'));
    raise exception 'FALHA: image_unit_cents negativo aceito';
  exception when invalid_parameter_value then null;
  end;
  termo := public.platform_save_terms(ator, jsonb_build_object(
    'org_id', sem, 'starts_on', mes, 'modality', 2, 'monthly_fee_cents', 0,
    'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
    'sonar_unit_cents', 0, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'teste sem preço'));
  perform pg_temp.afirmar((termo->>'image_unit_cents')::bigint = 0, 'image_unit_cents ausente deveria ser 0');

  -- Sem uso e sem preço: nenhuma linha "Imagens IA".
  prev := public.platform_billing_preview(ator, sem, mes);
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(prev->'lines') l where l->>'key' = 'image_ia'),
    'linha de imagem sem preço nem uso');

  -- Duas imagens geradas somam na fatura (uma nasce gerada, outra transita de pendente_upload).
  perform pg_temp.imagem(o, r1, 'gerada');
  perform pg_temp.imagem(o, r2, 'pendente_upload');
  perform pg_temp.afirmar(not exists (select 1 from public.platform_image_deliveries where request_id = r2), 'pendente_upload cobrou');
  update public.kit_variacao_imagens set status = 'gerada' where org_id = o and request_id = r2;

  -- Repetir o mesmo request_id não cobra de novo.
  update public.kit_variacao_imagens set status = 'gerada', atualizado_em = now() where org_id = o and request_id = r1;
  perform pg_temp.afirmar((select count(*) from public.platform_image_deliveries where org_id = o and request_id = r1) = 1,
    'request_id repetido cobrou de novo');

  -- Falha não cobra: pendente, recusada e pendente_upload sem repetição.
  perform pg_temp.imagem(o, gen_random_uuid(), 'pendente');
  perform pg_temp.imagem(o, gen_random_uuid(), 'recusada');
  perform pg_temp.imagem(o, rp, 'pendente_upload');
  update public.kit_variacao_imagens set status = 'recusada' where org_id = o and request_id = rp;
  perform pg_temp.afirmar((select count(*) from public.platform_image_deliveries where org_id = o) = 2, 'falha gerou cobrança');

  -- Entrega: preço congelado, custo real copiado, mês corrente.
  perform pg_temp.afirmar((select bool_and(units = 1 and unit_cents = 50 and total_cents = 50 and cost_usd = 0.041 and month = mes)
    from public.platform_image_deliveries where org_id = o), 'entrega com valores errados');

  prev := public.platform_billing_preview(ator, o, mes);
  select l into linha from jsonb_array_elements(prev->'lines') l where l->>'key' = 'image_ia';
  perform pg_temp.afirmar(linha->>'label' = 'Imagens IA' and (linha->>'quantity')::int = 2
    and (linha->>'unit_cents')::bigint = 50 and (linha->>'amount_cents')::bigint = 100, 'linha Imagens IA: ' || coalesce(linha::text, 'ausente'));
  perform pg_temp.afirmar((prev->>'image_units')::int = 2 and (prev->>'image_cents')::bigint = 100, 'totais de imagem na prévia');
  perform pg_temp.afirmar((prev->>'total_cents')::bigint = (prev->>'fee_cents')::bigint + 100, 'total sem as imagens');
  perform pg_temp.afirmar((prev->'sources')::text is not null, 'prévia sem sources');

  -- Condição comercial nova não altera o preço já entregue: versão 2 do mesmo mês com preço maior.
  insert into public.platform_commercial_terms (org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4, sonar_unit_cents, image_unit_cents,
    setup_fee_cents, setup_due_month, reason, created_by, version)
  values (o, mes, 2, 0, 700, 600, 550, 500, 0, 999, 0, null, 'reajuste', ator, 2);
  prev := public.platform_billing_preview(ator, o, mes);
  select l into linha from jsonb_array_elements(prev->'lines') l where l->>'key' = 'image_ia';
  perform pg_temp.afirmar((linha->>'amount_cents')::bigint = 100 and (prev->>'image_cents')::bigint = 100,
    'condição nova recalculou imagens já entregues');

  -- Mês fechado: o demonstrativo gravado volta igual depois da condição nova.
  insert into public.platform_commercial_terms (org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4, sonar_unit_cents, image_unit_cents,
    setup_fee_cents, setup_due_month, reason, created_by, version)
  values (sem, passado, 2, 0, 700, 600, 550, 500, 0, 50, 0, null, 'passado', ator, 1) returning id into termo_passado;
  insert into public.platform_image_deliveries (org_id, request_id, terms_id, month, unit_cents, units, total_cents, cost_usd)
  values (sem, gen_random_uuid(), termo_passado, passado, 50, 1, 50, 0.041);
  insert into public.platform_billing_statements (org_id, month, terms_id, revenue_bps, gross_cents, refund_cents,
    base_cents, fee_cents, sonar_cents, credit_cents, total_cents, revision, snapshot, closed_by)
  values (sem, passado, termo_passado, 700, 0, 0, 0, 0, 0, 0, 50, 'rev-teste',
    jsonb_build_object('total_cents', 50, 'image_units', 1, 'image_cents', 50), ator);
  insert into public.platform_commercial_terms (org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4, sonar_unit_cents, image_unit_cents,
    setup_fee_cents, setup_due_month, reason, created_by, version)
  values (sem, passado, 2, 0, 700, 600, 550, 500, 0, 999, 0, null, 'reajuste', ator, 2);
  fechado := public.platform_billing_close(ator, sem, passado, 'qualquer');
  perform pg_temp.afirmar((fechado->>'total_cents')::bigint = 50 and (fechado->>'image_cents')::bigint = 50,
    'mês fechado mudou com condição nova');
  prev := public.platform_billing_preview(ator, sem, passado);
  perform pg_temp.afirmar((prev->>'image_cents')::bigint = 50, 'prévia do mês passado repreçou a entrega');

  -- Org sem o módulo imagem_ia nunca é cobrada.
  perform pg_temp.imagem(sem, gen_random_uuid(), 'gerada');
  perform pg_temp.afirmar((select units = 0 and total_cents = 0 and reason = 'modulo_desligado'
    from public.platform_image_deliveries where org_id = sem and month = mes), 'org sem módulo cobrada');
  prev := public.platform_billing_preview(ator, sem, mes);
  perform pg_temp.afirmar(coalesce((prev->>'image_cents')::bigint, -1) = 0, 'prévia cobrou org sem módulo');

  -- Entregas são append-only.
  begin
    update public.platform_image_deliveries set units = 0 where org_id = o;
    raise exception 'FALHA: entrega alterada';
  exception when check_violation then null;
  end;
end $$;
rollback;
