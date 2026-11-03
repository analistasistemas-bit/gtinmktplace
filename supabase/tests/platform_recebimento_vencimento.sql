-- ADR-0193 Fatia 2a: dados de recebimento, vencimento (due_day) e cupons do vendedor no snapshot.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/platform_recebimento_vencimento.sql \
--          supabase/migrations/20261103004908_platform_recebimento_vencimento.sql
-- Sem a migration o teste falha (prova de vermelho): tabela, coluna e chaves da prévia não existem.
-- Tudo roda numa transação desfeita: org de teste, termos, perfil e auditoria somem no rollback.
begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  ator uuid;
  org uuid := gen_random_uuid();
  mes_atual date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  termo jsonb;
  perfil jsonb;
  detalhe jsonb;
  prev jsonb;
  st record;
  cupom_esperado bigint;
  falhou boolean;
  entrada jsonb := jsonb_build_object(
    'beneficiary_name', 'Teste Recebimento', 'document', '11144477735', 'bank_name', 'Banco Teste',
    'branch', '0001', 'account', '12345-6', 'pix_key_type', 'random',
    'pix_key', '123e4567-e89b-12d3-a456-426614174000', 'city', 'Fortaleza');
begin
  select id into ator from public.profiles where is_super_admin and is_active limit 1;
  if ator is null then raise exception 'sem super-admin ativo para o teste'; end if;

  -- 1. Tabela só de service_role: RLS sem policy e nenhum privilégio para PUBLIC/anon/authenticated.
  if not (select relrowsecurity from pg_class where oid = 'public.platform_payment_profile'::regclass) then
    raise exception 'RLS desabilitada em platform_payment_profile';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_payment_profile') then
    raise exception 'platform_payment_profile não pode ter policy';
  end if;
  if has_table_privilege('anon', 'public.platform_payment_profile', 'select')
     or has_table_privilege('anon', 'public.platform_payment_profile', 'truncate')
     or has_table_privilege('authenticated', 'public.platform_payment_profile', 'select')
     or has_table_privilege('authenticated', 'public.platform_payment_profile', 'insert')
     or has_table_privilege('authenticated', 'public.platform_payment_profile', 'truncate') then
    raise exception 'privilégio indevido em platform_payment_profile';
  end if;
  if not has_table_privilege('service_role', 'public.platform_payment_profile', 'select') then
    raise exception 'service_role (edge) precisa ler platform_payment_profile';
  end if;
  if has_function_privilege('anon', 'public.platform_save_payment_profile(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.platform_save_payment_profile(uuid,jsonb)', 'execute') then
    raise exception 'execute indevido em platform_save_payment_profile';
  end if;

  -- 2. Gravação por super-admin ativo: upsert de linha única + auditoria sem a chave inteira.
  perfil := public.platform_save_payment_profile(ator, entrada);
  perfil := public.platform_save_payment_profile(ator, entrada || '{"bank_name":"Banco Dois"}');
  if (select count(*) from public.platform_payment_profile) <> 1 or perfil->>'bank_name' <> 'Banco Dois'
     or (perfil->>'updated_by')::uuid <> ator then
    raise exception 'upsert de linha única falhou: %', perfil;
  end if;
  select details into detalhe from public.platform_audit_events
   where action = 'platform_payment_profile_saved' and actor_id = ator and org_id is null
   order by occurred_at desc limit 1;
  if detalhe is null or detalhe->>'pix_key_final' <> '4000' or detalhe::text like '%123e4567%'
     or detalhe::text like '%11144477735%' then
    raise exception 'auditoria do perfil inválida: %', detalhe;
  end if;

  -- 3. Ator sem super-admin → 42501; chave incoerente com o tipo → check da tabela.
  falhou := false;
  begin perform public.platform_save_payment_profile(gen_random_uuid(), entrada);
  exception when insufficient_privilege then falhou := true; end;
  if not falhou then raise exception 'ator comum gravou dados de recebimento'; end if;
  falhou := false;
  begin perform public.platform_save_payment_profile(ator, entrada || '{"pix_key_type":"cpf"}');
  exception when check_violation then falhou := true; end;
  if not falhou then raise exception 'chave aleatória aceita como cpf'; end if;
  -- e-mail no formato do DICT: aceita ASCII minúsculo com especiais; recusa acento, maiúscula e > 77.
  perfil := public.platform_save_payment_profile(ator, entrada || jsonb_build_object('pix_key_type', 'email', 'pix_key', 'o''neil+pix@sub.example.com'));
  if perfil->>'pix_key' <> 'o''neil+pix@sub.example.com' then raise exception 'e-mail DICT válido recusado: %', perfil; end if;
  foreach detalhe in array array['"joão@example.com"'::jsonb, '"Joao@example.com"'::jsonb,
      to_jsonb(repeat('a', 66) || '@example.com')] loop
    falhou := false;
    begin perform public.platform_save_payment_profile(ator, entrada || jsonb_build_object('pix_key_type', 'email', 'pix_key', detalhe));
    exception when check_violation then falhou := true; end;
    if not falhou then raise exception 'e-mail fora do DICT aceito: %', detalhe; end if;
  end loop;
  falhou := false;
  begin perform public.platform_save_payment_profile(ator, entrada - 'city');
  exception when invalid_parameter_value then falhou := true; end;
  if not falhou then raise exception 'perfil sem cidade aceito'; end if;

  -- 4. due_day: padrão 05 quando ausente, persistido quando informado, recusado fora de 1..28.
  insert into public.organizations (id, nome, slug) values (org, 'Teste Fatia 2a', 'teste-fatia-2a-' || left(org::text, 8));
  termo := public.platform_save_terms(ator, jsonb_build_object(
    'org_id', org, 'starts_on', mes_atual, 'modality', 2, 'monthly_fee_cents', 0,
    'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
    'sonar_unit_cents', 0, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'teste 2a'));
  if (termo->>'due_day')::int <> 5 then raise exception 'due_day padrão deveria ser 5: %', termo; end if;
  termo := public.platform_save_terms(ator, jsonb_build_object(
    'org_id', org, 'starts_on', (mes_atual + interval '1 month')::date, 'modality', 2, 'monthly_fee_cents', 0,
    'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
    'sonar_unit_cents', 0, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'teste 2a', 'due_day', 10));
  if (termo->>'due_day')::int <> 10 then raise exception 'due_day 10 não persistiu: %', termo; end if;
  foreach detalhe in array array['29'::jsonb, '0'::jsonb, '"10"'::jsonb, '5.5'::jsonb, 'null'::jsonb] loop
    falhou := false;
    begin perform public.platform_save_terms(ator, jsonb_build_object(
      'org_id', org, 'starts_on', (mes_atual + interval '1 month')::date, 'modality', 2, 'monthly_fee_cents', 0,
      'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
      'sonar_unit_cents', 0, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'teste 2a', 'due_day', detalhe));
    exception when invalid_parameter_value then falhou := true; end;
    if not falhou then raise exception 'due_day % aceito', detalhe; end if;
  end loop;

  -- 5. Prévia da org de teste: due_day dos termos resolvidos e cupom 0 sem vendas.
  prev := public.platform_billing_preview(ator, org, mes_atual);
  if (prev->>'due_day')::int <> 5 or (prev->>'seller_coupon_cents')::bigint <> 0 or prev->'terms'->>'due_day' <> '5' then
    raise exception 'prévia sem due_day/cupom: due_day=% cupom=%', prev->'due_day', prev->'seller_coupon_cents';
  end if;

  -- 6. Prévia real (mês da venda mais recente com cupom do vendedor): cupom = Σ cupom_vendedor na mesma
  --    janela/status das sources, e fica fora da revisão (sources não carregam cupom).
  select v.org_id, date_trunc('month', v.date_closed at time zone 'America/Fortaleza')::date as month into st
    from public.ml_vendas v where v.cupom_vendedor > 0 and v.status in ('paid','partially_refunded','refunded')
   order by v.date_closed desc limit 1;
  if st.org_id is null then raise exception 'nenhuma venda com cupom para o teste'; end if;
  prev := public.platform_billing_preview(ator, st.org_id, st.month);
  select round(coalesce(sum(coalesce(v.cupom_vendedor, 0)), 0) * 100)::bigint into cupom_esperado
    from public.ml_vendas v
   where v.org_id = st.org_id and v.status in ('paid','partially_refunded','refunded')
     and v.date_closed >= (st.month::text || ' 00:00:00 America/Fortaleza')::timestamptz
     and v.date_closed < (st.month::text || ' 00:00:00 America/Fortaleza')::timestamptz + interval '1 month';
  if cupom_esperado <= 0 or (prev->>'seller_coupon_cents')::bigint is distinct from cupom_esperado then
    raise exception 'cupom da prévia % <> esperado %', prev->>'seller_coupon_cents', cupom_esperado;
  end if;
  if (prev->'sources')::text like '%cupom%' or (prev->'sources')::text like '%coupon%' then
    raise exception 'cupom vazou para as sources (entraria na revisão)';
  end if;

  -- 7. Demonstrativo antigo (snapshot sem due_day/cupom) continua idempotente: close devolve o gravado.
  insert into public.platform_billing_statements (org_id, month, terms_id, revenue_bps, gross_cents, refund_cents,
    base_cents, fee_cents, sonar_cents, credit_cents, total_cents, revision, snapshot, closed_by)
  values (org, (mes_atual - interval '1 month')::date, (termo->>'id')::uuid, 700, 0, 0, 0, 0, 0, 0, 0, 'antiga',
    '{"revision":"antiga","total_cents":0}', ator)
  returning id, revision into st;
  prev := public.platform_billing_close(ator, org, (mes_atual - interval '1 month')::date, 'revisao-qualquer');
  if (prev->>'id')::uuid <> st.id or prev->>'revision' <> 'antiga' or prev ? 'due_day' then
    raise exception 'fechamento de mês fechado deixou de ser idempotente: %', prev;
  end if;
end $$;

rollback;
