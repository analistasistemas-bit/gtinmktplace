-- ============================================================================
-- Migration: e7_org_id_dominio
-- Refs: ADR-0027. Fase 1 do E7 (expand) — org_id NULLABLE em toda tabela de
-- domínio + backfill Avil + índices + trigger de default. NOT NULL só na Fase 3
-- (depois que o código gravar org_id) — zero janela de quebra.
-- ============================================================================

do $$
declare t text; v_org uuid;
begin
  select id into v_org from public.organizations where slug = 'avil';
  foreach t in array array[
    'lotes','familias','variacoes','anuncios_externos',
    'ml_credentials','ml_vendas','ml_vendas_itens','ml_perguntas',
    'ml_devolucoes','ml_moderacao','ml_webhook_eventos','configuracoes'
  ] loop
    execute format('alter table public.%I add column if not exists org_id uuid references public.organizations(id)', t);
    execute format('update public.%I set org_id = %L where org_id is null', t, v_org);
    execute format('create index if not exists %I on public.%I (org_id)', t || '_org_id_idx', t);
  end loop;
end $$;

-- Default para INSERTs autenticados (front). BEFORE trigger roda antes do WITH CHECK da RLS.
-- service_role: auth.uid() = null -> current_org_id() = null -> worker TEM de setar explicitamente
-- (o NOT NULL da fase 3 falha alto se algum caminho esquecer — defesa estrutural D-E7.5).
create or replace function public.org_id_default()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.org_id is null then
    new.org_id := public.current_org_id();
  end if;
  return new;
end $$;
revoke execute on function public.org_id_default() from public, anon, authenticated;

-- ml_credentials fica fora do trigger: escrita só por RPC service_role e a tabela
-- será substituída na Fase 5 (marketplace_connections).
do $$
declare t text;
begin
  foreach t in array array[
    'lotes','familias','variacoes','anuncios_externos',
    'ml_vendas','ml_vendas_itens','ml_perguntas',
    'ml_devolucoes','ml_moderacao','ml_webhook_eventos','configuracoes'
  ] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.org_id_default()',
                   t || '_org_default', t);
  end loop;
end $$;
