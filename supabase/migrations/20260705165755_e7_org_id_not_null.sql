-- ============================================================================
-- Migration: e7_org_id_not_null
-- Refs: ADR-0027. Fase 3 do E7 (contract) — org_id NOT NULL nas 11 tabelas
-- (exceção: ml_webhook_eventos, que espelha o user_id nullable de eventos de
-- vendedor desconhecido) + uniques por org. Roda DEPOIS do código gravar org_id
-- (Fase 2), então re-backfilla eventuais retardatários antes do NOT NULL.
-- ============================================================================

do $$
declare t text; v_org uuid;
begin
  select id into v_org from public.organizations where slug = 'avil';
  foreach t in array array[
    'lotes','familias','variacoes','anuncios_externos','ml_credentials',
    'ml_vendas','ml_vendas_itens','ml_perguntas','ml_devolucoes','ml_moderacao','configuracoes'
  ] loop
    execute format('update public.%I set org_id = %L where org_id is null', t, v_org);
    execute format('alter table public.%I alter column org_id set not null', t);
  end loop;
  -- ml_webhook_eventos: só re-backfill dos conhecidos; permanece nullable.
  update public.ml_webhook_eventos set org_id = v_org where org_id is null and user_id is not null;
end $$;

-- Identidade do anúncio passa a ser da ORG (era do user) — ADR-0025 § âncora.
-- Nome real do unique antigo confirmado no banco: anuncios_externos_user_canal_pai_particao_key.
alter table public.anuncios_externos
  drop constraint anuncios_externos_user_canal_pai_particao_key;
alter table public.anuncios_externos
  add constraint anuncios_externos_org_canal_pai_particao_key
  unique (org_id, canal, codigo_pai, particao);

-- 1 configuração por organização (linha atual da Avil já satisfaz).
create unique index configuracoes_org_uniq on public.configuracoes (org_id);
