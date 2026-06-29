-- ============================================================================
-- Migration: rls_operacao_compartilhada
-- Refs: ADR-0047. Swap user_id -> is_membro_operacao() nas tabelas de domínio.
-- user_id permanece como criado_por (auditoria).
-- ============================================================================

-- Tabelas operáveis (leitura/escrita por qualquer membro).
do $$
declare t text;
begin
  foreach t in array array['lotes','familias','variacoes','anuncios_externos'] loop
    execute format('drop policy if exists "%s: select own" on public.%I', t, t);
    execute format('drop policy if exists "%s: insert own" on public.%I', t, t);
    execute format('drop policy if exists "%s: update own" on public.%I', t, t);
    execute format('drop policy if exists "%s: delete own" on public.%I', t, t);
    execute format('create policy "%s: select membro" on public.%I for select using (public.is_membro_operacao())', t, t);
    execute format('create policy "%s: insert membro" on public.%I for insert with check (public.is_membro_operacao())', t, t);
    execute format('create policy "%s: update membro" on public.%I for update using (public.is_membro_operacao()) with check (public.is_membro_operacao())', t, t);
    execute format('create policy "%s: delete membro" on public.%I for delete using (public.is_membro_operacao())', t, t);
  end loop;
end $$;

-- Tabelas só-leitura no app (populadas por service_role/webhooks): apenas SELECT.
do $$
declare t text;
begin
  foreach t in array array['ml_credentials','ml_vendas','ml_vendas_itens','ml_perguntas','ml_devolucoes','ml_moderacao','ml_webhook_eventos'] loop
    execute format('drop policy if exists "%s: select own" on public.%I', t, t);
    execute format('create policy "%s: select membro" on public.%I for select using (public.is_membro_operacao())', t, t);
  end loop;
end $$;

-- configuracoes: leitura compartilhada (operação), escrita só admin.
drop policy if exists "configuracoes_select_own" on public.configuracoes;
drop policy if exists "configuracoes_insert_own" on public.configuracoes;
drop policy if exists "configuracoes_update_own" on public.configuracoes;
create policy "configuracoes: select membro" on public.configuracoes
  for select using (public.is_membro_operacao());
create policy "configuracoes: insert admin" on public.configuracoes
  for insert with check (public.is_admin());
create policy "configuracoes: update admin" on public.configuracoes
  for update using (public.is_admin()) with check (public.is_admin());

-- Storage: bucket de imagens vira leitura por qualquer membro (upload segue na pasta do uid).
drop policy if exists "imagens: select own" on storage.objects;
create policy "imagens: select membro" on storage.objects
  for select using (bucket_id = 'imagens' and (select auth.role()) = 'authenticated');
