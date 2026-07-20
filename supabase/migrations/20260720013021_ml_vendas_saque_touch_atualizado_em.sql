-- Poll incremental de vendas por marca d'água (ADR-0082): as duas RPCs de saque alteram
-- sacado_em/sacado_por sem bumpar atualizado_em, então o delta de useVendas ficaria cego a
-- elas e o check de "sacado" não apareceria na tela até um fetch completo.
--
-- ATENÇÃO ao recriar: o corpo abaixo é o que está EM PRODUÇÃO hoje, extraído com
-- pg_get_functiondef — NÃO é o da migration original 20260702162832. A E7 dropou
-- `is_membro_operacao()` (20260705165828_e7_rls_org.sql) e a 20260705200441_e7_fix_saque_org.sql
-- reescreveu estas duas funções para `current_org_id()` + filtro `org_id = v_org` (isolamento
-- multi-tenant, ADR-0027). Copiar da migration antiga quebraria o saque (função inexistente) e
-- removeria o filtro de organização. A ÚNICA diferença aqui é a linha `atualizado_em = now()`.

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
         sacado_por = auth.uid(),
         atualizado_em = now()   -- ADR-0082: sem isto o saque some do delta do poll
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
         sacado_por = null,
         atualizado_em = now()   -- ADR-0082
   where id = any(p_ids)
     and org_id = v_org
     and sacado_em is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.registrar_saque_ml_vendas(uuid[]) from public;
revoke all on function public.desfazer_saque_ml_vendas(uuid[]) from public;
grant execute on function public.registrar_saque_ml_vendas(uuid[]) to authenticated;
grant execute on function public.desfazer_saque_ml_vendas(uuid[]) to authenticated;
