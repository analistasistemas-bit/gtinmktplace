-- ============================================================================
-- ADR-0086 Increment C — configuracoes: org_id vira a chave + seed por org
-- ============================================================================
-- Fecha o org-scoping da config: a identidade da linha passa a ser a ORG, não o usuário.
-- Zero churn de código: nenhum código LÊ configuracoes.user_id (só o upsert do front o SETa, que
-- segue por onConflict:'org_id'). Tabela minúscula (1 linha/org) → sem rewrite, lock instantâneo.
-- ORDEM IMPORTA: trocar a PK e tornar user_id nullable ANTES do backfill (senão o INSERT (org_id)
-- com user_id NULL falharia enquanto user_id ainda for PK NOT NULL).

-- Falha rápido se um lock estiver retido por transação aberta, em vez de bloquear indefinidamente.
set local lock_timeout = '5s';

-- 1) org_id vira a PRIMARY KEY, reusando o índice único já existente (sem rewrite). Remove a PK
--    antiga (user_id) no MESMO ALTER (o nome configuracoes_pkey é liberado e reusado).
alter table public.configuracoes
  drop constraint configuracoes_pkey,
  add constraint configuracoes_pkey primary key using index configuracoes_org_uniq;

-- 2) Índice não-único de org_id fica redundante com a nova PK.
drop index if exists public.configuracoes_org_id_idx;

-- 3) user_id deixa de ser identidade → auditoria da ÚLTIMA edição: nullable + FK ON DELETE SET NULL
--    (o CASCADE atual apagaria a config da ORG ao deletar o usuário editor). Nome mantido → zero churn.
alter table public.configuracoes alter column user_id drop not null;
alter table public.configuracoes drop constraint configuracoes_user_id_fkey;
alter table public.configuracoes
  add constraint configuracoes_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- 4) FK org_id → ON DELETE CASCADE: a config PERTENCE à org (deletou a org, some a config). Hoje é
--    NO ACTION, que passaria a BLOQUEAR a exclusão de org com config — inclusive o ROLLBACK do
--    create_org (delete da org quando o convite do admin falha), pois o trigger (abaixo) cria a
--    config no MESMO insert da org. CASCADE destrava isso e é a semântica correta.
alter table public.configuracoes drop constraint configuracoes_org_id_fkey;
alter table public.configuracoes
  add constraint configuracoes_org_id_fkey
  foreign key (org_id) references public.organizations(id) on delete cascade;

-- 5) Seed automático: toda org NOVA nasce com uma linha de config (defaults; aliquotas_confirmadas_em
--    NULL → LOUD até o admin confirmar; user_id NULL). security definer p/ contornar a RLS (escrita =
--    admin), search_path fixo e nomes qualificados (padrão E7). Idempotente. Trigger ANTES do backfill
--    para não deixar janela de uma org nascer entre o backfill e a criação do trigger.
create or replace function public.seed_configuracoes_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.configuracoes (org_id) values (new.id)
  on conflict (org_id) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_configuracoes_org() from public;

drop trigger if exists trg_seed_configuracoes_org on public.organizations;
create trigger trg_seed_configuracoes_org
  after insert on public.organizations
  for each row execute function public.seed_configuracoes_org();

-- 6) Backfill por ÚLTIMO: garante 1 linha de config por org existente sem config (a DSA hoje).
--    user_id já é nullable → INSERT (org_id) grava user_id NULL sem violar nada. Defaults da coluna
--    (alíquota 8/16, aliquotas_confirmadas_em NULL) → a org continua no LOUD até confirmar. Idempotente.
insert into public.configuracoes (org_id)
select o.id from public.organizations o
where not exists (select 1 from public.configuracoes c where c.org_id = o.id)
on conflict (org_id) do nothing;
