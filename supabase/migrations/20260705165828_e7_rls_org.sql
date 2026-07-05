-- ============================================================================
-- Migration: e7_rls_org
-- Refs: ADR-0027. Fase 4 do E7 — RLS por organização (o coração do isolamento).
-- Template = loop do ADR-0047 (20260629030910). Para os usuários da Avil NADA
-- muda (todos têm current_org_id() = org Avil e todas as linhas têm org_id=Avil).
-- Nomes de policy antigos confirmados em 20260629030910_rls_operacao_compartilhada.sql.
-- ============================================================================

-- Grupo A: operáveis (CRUD por membro da org).
do $$
declare t text;
begin
  foreach t in array array['lotes','familias','variacoes','anuncios_externos'] loop
    execute format('drop policy if exists "%s: select membro" on public.%I', t, t);
    execute format('drop policy if exists "%s: insert membro" on public.%I', t, t);
    execute format('drop policy if exists "%s: update membro" on public.%I', t, t);
    execute format('drop policy if exists "%s: delete membro" on public.%I', t, t);
    execute format('create policy "%s: select org" on public.%I for select to authenticated using (org_id = (select public.current_org_id()))', t, t);
    execute format('create policy "%s: insert org" on public.%I for insert to authenticated with check (org_id = (select public.current_org_id()))', t, t);
    execute format('create policy "%s: update org" on public.%I for update to authenticated using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()))', t, t);
    execute format('create policy "%s: delete org" on public.%I for delete to authenticated using (org_id = (select public.current_org_id()))', t, t);
  end loop;
end $$;

-- Grupo B: só-leitura no app (escrita segue service_role-only, sem policy de escrita).
do $$
declare t text;
begin
  foreach t in array array['ml_credentials','ml_vendas','ml_vendas_itens','ml_perguntas','ml_devolucoes','ml_moderacao','ml_webhook_eventos'] loop
    execute format('drop policy if exists "%s: select membro" on public.%I', t, t);
    execute format('create policy "%s: select org" on public.%I for select to authenticated using (org_id = (select public.current_org_id()))', t, t);
  end loop;
end $$;

-- Grupo C: configuracoes (leitura org; escrita admin da org).
drop policy if exists "configuracoes: select membro" on public.configuracoes;
drop policy if exists "configuracoes: insert admin" on public.configuracoes;
drop policy if exists "configuracoes: update admin" on public.configuracoes;
create policy "configuracoes: select org" on public.configuracoes
  for select to authenticated using (org_id = (select public.current_org_id()));
create policy "configuracoes: insert admin org" on public.configuracoes
  for insert to authenticated with check (org_id = (select public.current_org_id()) and public.is_admin());
create policy "configuracoes: update admin org" on public.configuracoes
  for update to authenticated
  using (org_id = (select public.current_org_id()) and public.is_admin())
  with check (org_id = (select public.current_org_id()) and public.is_admin());

-- profiles: admin só enxerga/gerencia perfis da própria org (mantém is_admin() + escopo org).
drop policy if exists "profiles: select self or admin" on public.profiles;
create policy "profiles: select self or admin org" on public.profiles
  for select to authenticated
  using (id = (select auth.uid())
         or (public.is_admin() and org_id = (select public.current_org_id())));
drop policy if exists "profiles: admin insert" on public.profiles;
create policy "profiles: admin insert org" on public.profiles
  for insert to authenticated
  with check (public.is_admin() and org_id = (select public.current_org_id()));
drop policy if exists "profiles: admin update" on public.profiles;
create policy "profiles: admin update org" on public.profiles
  for update to authenticated
  using (public.is_admin() and org_id = (select public.current_org_id()))
  with check (public.is_admin() and org_id = (select public.current_org_id()));
drop policy if exists "profiles: admin delete" on public.profiles;
create policy "profiles: admin delete org" on public.profiles
  for delete to authenticated
  using (public.is_admin() and org_id = (select public.current_org_id()));

-- Storage: leitura = o DONO do path (1ª pasta) pertence à MINHA org. Paths não mudam.
drop policy if exists "imagens: select membro" on storage.objects;
create policy "imagens: select org" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'imagens'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.org_id = (select public.current_org_id())
    )
  );
-- insert/update/delete "own" (auth.uid() = 1ª pasta) permanecem como estão.

-- O gancho intermediário do ADR-0047 morre aqui.
drop function public.is_membro_operacao();
