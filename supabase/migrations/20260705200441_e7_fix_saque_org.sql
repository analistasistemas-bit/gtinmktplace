-- ============================================================================
-- Migration: e7_fix_saque_org
-- Refs: ADR-0027 (E7), ADR-0053 (saque manual). Fix pós-E7.
-- As RPCs registrar_saque_ml_vendas/desfazer_saque_ml_vendas (20260702162832)
-- chamavam public.is_membro_operacao() no corpo — função DROPADA pelo swap de RLS
-- do E7 (20260705165828). Postgres não rastreia dependência de corpo plpgsql, então
-- o drop passou, mas qualquer chamada dessas RPCs falharia em runtime.
-- Fix: guard por public.current_org_id() (membro ativo com org) + escopo do UPDATE
-- por org (isolamento: SECURITY DEFINER bypassa RLS, então filtra org_id explicito
-- para não marcar saque em vendas de outra organização).
-- ============================================================================

create or replace function public.registrar_saque_ml_vendas(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_count integer;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'not allowed';
  end if;

  update public.ml_vendas
     set sacado_em = now(),
         sacado_por = auth.uid()
   where id = any(p_ids)
     and org_id = v_org
     and money_release_date is not null
     and money_release_date <= now()
     and sacado_em is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.desfazer_saque_ml_vendas(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_count integer;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'not allowed';
  end if;

  update public.ml_vendas
     set sacado_em = null,
         sacado_por = null
   where id = any(p_ids)
     and org_id = v_org
     and sacado_em is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
