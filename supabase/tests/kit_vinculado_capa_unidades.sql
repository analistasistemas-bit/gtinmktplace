\set ON_ERROR_STOP on
-- ADR-0205 (migration kit_variacao_imagens_unidades): capa do kit vinculado com N unidades em kit_variacao_imagens.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/kit_vinculado_capa_unidades.sql \
--          supabase/migrations/20261112193715_kit_variacao_imagens_unidades.sql
-- Só toca dados do próprio fixture (orgs, usuário, termos, imagens, entregas); tudo some no rollback.
begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97950000-0000-0000-0000-000000000001', 'Capa unidades', 'capa-unidades-teste', array['imagem_ia'], true),
  ('97950000-0000-0000-0000-000000000002', 'Capa unidades sem modulo', 'capa-unidades-sem-modulo-teste', array[]::text[], true);
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('97950000-0000-0000-0000-000000000101', 'admin-capa-unidades@teste.local',
   '{}'::jsonb, '{"org_id":"97950000-0000-0000-0000-000000000001"}'::jsonb);
update public.profiles set is_super_admin = true, org_id = null, is_active = true where id = '97950000-0000-0000-0000-000000000101';

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;

-- Linha de unidades: cores e rótulo nulos, n preenchido.
create or replace function pg_temp.unidades(o uuid, r uuid, st text, qtd smallint) returns void language sql as $$
  insert into public.kit_variacao_imagens (org_id, request_id, status, familia_base_id, cores, rotulo, n, modelo, storage_path, custo_usd)
  values (o, r, st, gen_random_uuid(), null, null, qtd, 'google/gemini-nano-banana-2.1',
    case when st in ('gerada','pendente_upload') then o || '/kit-variacao-ia/' || r || '.png' end,
    case when st in ('gerada','pendente_upload','recusada') then 0.055 end)
$$;

-- Insere e devolve se o check recusou.
create or replace function pg_temp.recusa(o uuid, cs text[], rot text, qtd smallint) returns boolean language plpgsql as $$
begin
  insert into public.kit_variacao_imagens (org_id, request_id, familia_base_id, cores, rotulo, n, modelo)
  values (o, gen_random_uuid(), gen_random_uuid(), cs, rot, qtd, 'google/gemini-nano-banana-2.1');
  return false;
exception when check_violation then return true;
end $$;

do $$
declare
  ator uuid := '97950000-0000-0000-0000-000000000101';
  o uuid := '97950000-0000-0000-0000-000000000001';
  sem uuid := '97950000-0000-0000-0000-000000000002';
  mes date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  r1 uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  r3 uuid := gen_random_uuid();
  ent public.platform_image_deliveries%rowtype;
  recusou boolean;
begin
  -- Condição comercial com preço por imagem só na org com módulo.
  perform public.platform_save_terms(ator, jsonb_build_object(
    'org_id', o, 'starts_on', mes, 'modality', 2, 'monthly_fee_cents', 0,
    'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
    'sonar_unit_cents', 0, 'image_unit_cents', 50, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'teste capa unidades'));

  -- Capa de 6 unidades gerada: cobrança herdada pelo mesmo trigger, 1 entrega com units = 1.
  perform pg_temp.unidades(o, r1, 'gerada', 6::smallint);
  perform pg_temp.afirmar((select count(*) = 1 from public.platform_image_deliveries where org_id = o and request_id = r1),
    'linha de unidades gerada não gerou exatamente 1 entrega');
  select * into ent from public.platform_image_deliveries where org_id = o and request_id = r1;
  perform pg_temp.afirmar(ent.units = 1 and ent.unit_cents = 50 and ent.total_cents = 50 and ent.cost_usd = 0.055,
    'entrega da capa de unidades com valores errados');

  -- Repetir a transição para gerada não cobra de novo.
  update public.kit_variacao_imagens set atualizado_em = now(), status = 'gerada' where org_id = o and request_id = r1;
  perform pg_temp.afirmar((select count(*) = 1 from public.platform_image_deliveries where org_id = o and request_id = r1),
    'segunda transição para gerada cobrou de novo');

  -- Segunda linha viva do mesmo request_id: recusada (índice único parcial).
  begin
    insert into public.kit_variacao_imagens (org_id, request_id, tentativa, familia_base_id, n, modelo)
    values (o, r1, 2, gen_random_uuid(), 6, 'google/gemini-nano-banana-2.1');
    recusou := false;
  exception when unique_violation then recusou := true;
  end;
  perform pg_temp.afirmar(recusou, 'segunda linha viva do mesmo request_id aceita');

  -- Org sem módulo imagem_ia: entrega registrada com units = 0.
  perform pg_temp.unidades(sem, r2, 'gerada', 3::smallint);
  select * into ent from public.platform_image_deliveries where org_id = sem and request_id = r2;
  perform pg_temp.afirmar(found and ent.units = 0 and ent.total_cents = 0 and ent.reason = 'modulo_desligado',
    'org sem módulo deveria registrar entrega com units = 0');

  -- Pendente e recusada de unidades não cobram.
  perform pg_temp.unidades(o, r3, 'recusada', 2::smallint);
  perform pg_temp.afirmar(not exists (select 1 from public.platform_image_deliveries where org_id = o and request_id = r3),
    'recusada de unidades cobrou');

  -- Check estrito: ou cores, ou unidades.
  perform pg_temp.afirmar(pg_temp.recusa(o, null, null, null), 'linha sem cores e sem n aceita');
  perform pg_temp.afirmar(pg_temp.recusa(o, array['Preto'], 'Preto', 6::smallint), 'linha com n e cores aceita');
  perform pg_temp.afirmar(pg_temp.recusa(o, null, 'Preto', 6::smallint), 'linha com n e rótulo aceita');
  perform pg_temp.afirmar(pg_temp.recusa(o, array['Preto'], null, null), 'linha de cores sem rótulo aceita');
  perform pg_temp.afirmar(pg_temp.recusa(o, null, null, 1::smallint), 'n = 1 aceito');
  perform pg_temp.afirmar(pg_temp.recusa(o, null, null, 7::smallint), 'n = 7 aceito');
  perform pg_temp.afirmar(not pg_temp.recusa(o, null, null, 2::smallint), 'n = 2 recusado');

  -- Linha antiga (cores preenchido, n nulo) continua válida, e as já gravadas em produção também.
  perform pg_temp.afirmar(not pg_temp.recusa(o, array['Preto','Branco'], 'Preto e Branco', null), 'linha de cores recusada');
  perform pg_temp.afirmar(not exists (select 1 from public.kit_variacao_imagens
      where not ((n is null and cores is not null and rotulo is not null) or (n is not null and cores is null and rotulo is null))),
    'linha existente viola o check novo');

  -- Índice do teto diário (org, base, n, criado_em).
  perform pg_temp.afirmar(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'kit_variacao_imagens'
      and indexname = 'kit_variacao_imagens_teto_unidades_idx'
      and indexdef like '%(org_id, familia_base_id, n, criado_em)%'), 'índice do teto ausente');

  -- Trigger de cobrança intacto; tabela só de service_role.
  perform pg_temp.afirmar(exists (select 1 from pg_trigger where tgrelid = 'public.kit_variacao_imagens'::regclass
      and tgname = 'kit_variacao_imagens_cobranca' and tgenabled = 'O'), 'trigger de cobrança ausente');
  perform pg_temp.afirmar((select relrowsecurity from pg_class where oid = 'public.kit_variacao_imagens'::regclass), 'RLS desligada');
  perform pg_temp.afirmar(not has_table_privilege('authenticated', 'public.kit_variacao_imagens', 'select'), 'authenticated lê a tabela');
  perform pg_temp.afirmar(not has_table_privilege('anon', 'public.kit_variacao_imagens', 'select'), 'anon lê a tabela');
end $$;
rollback;
