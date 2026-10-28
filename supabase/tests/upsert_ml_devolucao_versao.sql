-- ADR-0192: upsert_ml_devolucao não deixa snapshot antigo sobrescrever o novo.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/upsert_ml_devolucao_versao.sql supabase/migrations/20261028160330_posvenda_upsert_devolucao.sql
begin;
do $$
declare
  u uuid := (select id from auth.users limit 1);
  o uuid := (select id from public.organizations limit 1);
  r jsonb;
begin
  if u is null then raise exception 'sem auth.users para o teste'; end if;

  -- linha nova -> inserida
  r := public.upsert_ml_devolucao(jsonb_build_object('user_id', u, 'org_id', o, 'claim_id', 990000001,
        'status', 'opened', 'lido_em', '2026-10-28T12:00:00Z', 'revisao_pendente', true));
  if r->>'status' <> 'opened' then raise exception 'insert falhou: %', r; end if;

  -- T1 < T2 -> inalterada
  r := public.upsert_ml_devolucao(jsonb_build_object('user_id', u, 'org_id', o, 'claim_id', 990000001,
        'status', 'ANTIGO', 'lido_em', '2026-10-28T11:00:00Z'));
  if r->>'status' <> 'opened' then raise exception 'snapshot antigo sobrescreveu: %', r; end if;

  -- T3 > T2 -> aplicada, e coluna ausente do json nao e apagada
  r := public.upsert_ml_devolucao(jsonb_build_object('user_id', u, 'org_id', o, 'claim_id', 990000001,
        'status', 'closed', 'lido_em', '2026-10-28T13:00:00Z'));
  if r->>'status' <> 'closed' then raise exception 'snapshot novo nao aplicado: %', r; end if;
  if (r->>'revisao_pendente')::boolean is not true then raise exception 'coluna nao lida foi apagada: %', r; end if;
  if (select count(*) from public.ml_devolucoes where user_id = u and claim_id = 990000001) <> 1 then
    raise exception 'duplicou linha';
  end if;

  -- sem lido_em (chamada antiga) -> aplica e preserva lido_em
  r := public.upsert_ml_devolucao(jsonb_build_object('user_id', u, 'org_id', o, 'claim_id', 990000001, 'status', 'legado'));
  if r->>'status' <> 'legado' then raise exception 'chamada sem lido_em nao aplicou: %', r; end if;
  if r->>'lido_em' is null then raise exception 'lido_em foi apagado'; end if;

  -- so service_role executa
  if has_function_privilege('anon', 'public.upsert_ml_devolucao(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.upsert_ml_devolucao(jsonb)', 'execute') then
    raise exception 'anon/authenticated executam o RPC';
  end if;
end $$;
rollback;
