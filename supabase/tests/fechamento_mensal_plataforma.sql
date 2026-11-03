-- ADR-0193 Fatia 3: categoria de plataforma `fechamento_mensal` e chave de deduplicação do aviso.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/fechamento_mensal_plataforma.sql \
--          supabase/migrations/20261103014103_fechamento_mensal_plataforma.sql
-- Sem a migration o teste falha (prova de vermelho): a categoria é recusada e o 2º aviso entra.
-- Tudo roda numa transação desfeita.
begin;

do $$
declare
  ator uuid;
  dup boolean := false;
begin
  select id into ator from public.profiles where is_super_admin and is_active limit 1;
  if ator is null then raise exception 'sem super-admin ativo para o teste'; end if;

  -- 1. Super-admin assina a categoria de plataforma (constraint aceita).
  update public.profiles set telegram_categorias = array['fechamento_mensal'] where id = ator;

  -- 2. Categoria desconhecida continua recusada.
  begin
    update public.profiles set telegram_categorias = array['inexistente'] where id = ator;
    raise exception 'categoria inválida passou';
  exception when check_violation then null;
  end;

  -- 3. Um aviso por competência: o 2º insert com o mesmo target colide (23505).
  insert into public.platform_audit_events (org_id, actor_id, category, action, result, target, details)
    values (null, ator, 'billing', 'fechamento_mensal_aviso', 'success', '2099-01', '{}');
  begin
    insert into public.platform_audit_events (org_id, actor_id, category, action, result, target, details)
      values (null, ator, 'billing', 'fechamento_mensal_aviso', 'success', '2099-01', '{}');
  exception when unique_violation then dup := true;
  end;
  if not dup then raise exception 'aviso duplicado na mesma competência'; end if;

  -- 4. Outra competência e outros eventos com o mesmo target não colidem.
  insert into public.platform_audit_events (org_id, actor_id, category, action, result, target, details)
    values (null, ator, 'billing', 'fechamento_mensal_aviso', 'success', '2099-02', '{}');
  insert into public.platform_audit_events (org_id, actor_id, category, action, result, target, details)
    values (null, ator, 'billing', 'outra_acao', 'success', '2099-01', '{}'),
           (null, ator, 'billing', 'outra_acao', 'success', '2099-01', '{}');
end $$;

rollback;
