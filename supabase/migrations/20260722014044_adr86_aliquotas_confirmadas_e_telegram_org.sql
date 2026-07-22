-- ============================================================================
-- ADR-0086 Increment B — LOUD do imposto + telegram_config_status org-scoped
-- ============================================================================

-- 1) Flag de confirmação explícita das alíquotas (refina ADR-0055). A coluna de alíquota tem
--    default 8/16 NOT NULL, então "linha existe" NÃO prova que a org confirmou o imposto. Esta flag
--    distingue "confirmado pelo admin" de "default seedado". Sem ela, o process-familia falha LOUD
--    em vez de precificar com 8/16 em silêncio.
alter table public.configuracoes
  add column if not exists aliquotas_confirmadas_em timestamptz;

-- Backfill (grandfather): toda config JÁ EXISTENTE é marcada como confirmada — são orgs que já
-- operam com essas alíquotas (na aplicação desta migration, só a Avil, com 147 anúncios publicados).
-- Orgs novas nascem sem linha (ou sem esta flag) → caem no LOUD até confirmar. Zero disrupção para
-- quem já publica.
update public.configuracoes
  set aliquotas_confirmadas_em = coalesce(atualizado_em, now())
  where aliquotas_confirmadas_em is null;

-- 2) telegram_config_status: passa a filtrar por org (era user_id = auth.uid(), que retornava vazio
--    para outro membro da mesma org e quebraria ao consolidar a config por org — ADR-0086).
--    `create or replace` preserva os grants (revoke public / grant authenticated); reafirmados abaixo.
create or replace function public.telegram_config_status()
returns table(chat_id text, ativo boolean, tem_token boolean)
language sql
security definer
set search_path = public
as $$
  select telegram_chat_id,
         coalesce(telegram_ativo, false),
         (telegram_bot_token is not null and telegram_bot_token <> '')
  from public.configuracoes
  where org_id = (select public.current_org_id());
$$;

revoke all on function public.telegram_config_status() from public;
grant execute on function public.telegram_config_status() to authenticated;
