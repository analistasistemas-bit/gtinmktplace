-- ============================================================================
-- Migration: revoke_helpers_anon
-- Refs: ADR-0047. Advisor 0028/0029: o Supabase concede EXECUTE direto a
-- anon/authenticated por default privileges, então o `revoke from public` da
-- migration de helpers foi no-op. Aqui revogamos explicitamente.
-- ============================================================================

-- Helpers de RLS: a RLS é avaliada no contexto do chamador, então 'authenticated'
-- PRECISA executar; 'anon' não (não acessa tabelas de domínio).
revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_membro_operacao() from anon;

-- Trigger function: nunca deve ser chamada via RPC (corpo usa NEW de trigger).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
