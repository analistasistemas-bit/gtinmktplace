# Vigência Imediata no Cadastro de Condições Comerciais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alterar o comportamento do cadastro de condições comerciais para que o primeiro contrato inicie por padrão no mês corrente (em vez de no próximo mês) e corrigir cirurgicamente a vigência das 3 organizações existentes (Avil, DSA, Daludi Shop) para 2026-09 com máxima segurança multi-tenant.

**Architecture:** Uma migration SQL com pré-condições incondicionais executadas ANTES de qualquer DDL ou lock (retornando no-op absoluto se zero organizações existirem e abortando com exceção se 1 ou 2 existirem) e com validação estrita individual de contrato inaugural por tenant (`version = 1`, `starts_on = '2026-10-01'`, `count = 1`). Apenas após as pré-condições satisfeitas, desabilita temporariamente o trigger de imutabilidade, atualiza cirurgicamente cada termo para `2026-09-01` materializando em tabela temporária, gera auditorias completas em `platform_audit_events` e executa asserções LOUD (3 linhas no total, 1 linha por slug e 0 resíduos). No frontend, o componente `CommercialTermsForm` calcula competências dinamicamente no fuso de Fortaleza (`America/Fortaleza`), sincroniza em foco e no submit contra viradas de mês (cobrindo a fronteira `02:59Z → 03:01Z`), aplica clamping no `setupDueMonth` e conecta explicitamente `setup_due_month: effectiveSetupDue` no payload de salvamento. O processo em produção inclui um gate operacional de preview, digest criptográfico determinístico completo das tabelas de termos e auditorias de outros tenants e autorização humana explícita conforme as regras do `AGENTS.md`.

**Tech Stack:** Supabase PostgreSQL (PL-pgSQL), React, TypeScript, Vitest, Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-19-condicoes-comerciais-vigencia-cadastro-design.md](../specs/2026-09-19-condicoes-comerciais-vigencia-cadastro-design.md)

## Global Constraints

- Banco de dados: Supabase PostgreSQL (confirmado pelo operador).
- Apenas o primeiro contrato (`current === null`) inicia por padrão no mês corrente; renegociações continuam valendo a partir do próximo mês (`effectiveStartsOn = nextMonthStart()`).
- A migration SQL deve validar incondicionalmente a presença das 3 organizações alvo (`avil`, `diego-souza`, `daludishop`) ANTES de qualquer DDL ou desativação de trigger, falhar se qualquer uma faltar (abortando mutações parciais) e ser no-op absoluto se zero existirem.
- Clamping obrigatório no frontend: `setupDueMonth` nunca pode anteceder `startsOn`, tanto na interação do usuário quanto na sanitização defensiva do `submit`, sendo passado explicitamente a `save.mutateAsync({ ..., setup_due_month: effectiveSetupDue })`.
- Proteção contra virada de competência: cálculo dinâmico no fuso oficial de Fortaleza (`America/Fortaleza`, UTC-3), sincronizando e alertando o usuário tanto no evento de `focus` (envolvido em `act()`) quanto no `submit` ao cruzar a virada do mês (`02:59Z → 03:01Z`), atualizando `startsOn` e `setupDueMonth` na interface.
- O trigger `platform_commercial_terms_no_mutation` deve ser reabilitado na mesma transação.
- Proibido deploy automático via insforge; esperar comando do usuário.
- Gate de segurança para dados reais multi-tenant (AGENTS.md): preview somente-leitura e autorização humana de Diego antes de qualquer mutação em produção, seguido de prova matemática de isolamento dos demais tenants via digest MD5 determinístico de linhas completas (`row_to_json`) em `platform_commercial_terms` e `platform_audit_events`.

---

### Task 0: Gate Operacional de Segurança Multi-Tenant em Produção (AGENTS.md)

**Files:**
- N/A (Operação controlada via CLI / psql / Supabase)

**Interfaces:**
- Produces: Relatório de preview somente-leitura dos contratos das 3 organizações e prova de isolamento total dos demais tenants via digests determinísticos antes e depois da migração.

- [ ] **Step 1: Consulta de Preview Somente-Leitura em Produção**

Antes de aplicar a migration em produção, executar a consulta somente-leitura dos alvos:
```sql
select
  o.slug,
  o.nome,
  o.id as org_id,
  t.id as term_id,
  t.version,
  t.starts_on as starts_on_atual,
  t.setup_due_month as setup_due_atual,
  t.created_at
from public.organizations o
join public.platform_commercial_terms t on t.org_id = o.id
where o.slug in ('avil', 'diego-souza', 'daludishop')
order by o.slug;
```

E capturar a prova de isolamento dos demais tenants (contagem e digest MD5 determinístico sobre o JSON da linha completa) em ambas as tabelas tocadas:

1. Tabela `platform_commercial_terms`:
```sql
select
  count(*) as total_outros_termos,
  coalesce(md5(string_agg(row_to_json(t.*)::text, '' order by t.id)), 'empty') as digest_outros_termos
from public.platform_commercial_terms t
where t.org_id not in (
  select id from public.organizations where slug in ('avil', 'diego-souza', 'daludishop')
);
```

2. Tabela `platform_audit_events`:
```sql
select
  count(*) as total_outras_auditorias,
  coalesce(md5(string_agg(row_to_json(a.*)::text, '' order by a.id)), 'empty') as digest_outras_auditorias
from public.platform_audit_events a
where a.org_id not in (
  select id from public.organizations where slug in ('avil', 'diego-souza', 'daludishop')
);
```

- [ ] **Step 2: Gate de Autorização Humana Explícita**

Apresentar a tabela com os nomes, `org_id`, `term_id`, versões, valores atuais e os digests ao operador (Diego). Solicitar autorização explícita antes de qualquer comando de mutação em produção (`supabase db push`).

- [ ] **Step 3: Readback de Produção Pós-Execução**

Após a execução da migration em produção:
1. Confirmar que as 3 organizações exibem `starts_on = '2026-09-01'` e `setup_due_month = '2026-09-01'`, mantendo `version = 1`.
2. Reexecutar as consultas de contagem e digest dos demais tenants em `platform_commercial_terms` e `platform_audit_events` e provar que `total_outros_termos`, `digest_outros_termos`, `total_outras_auditorias` e `digest_outras_auditorias` permanecem rigorosamente idênticos aos valores do Step 1, comprovando matematicamente que nenhum outro tenant sofreu qualquer impacto ou efeito colateral.

---

### Task 1: Migration SQL de Correção Cirúrgica de Vigência para Setembro/2026

**Files:**
- Create: `supabase/migrations/20260919160000_platform_terms_vigencia_setembro.sql`
- Modify: `supabase/tests/platform_commercial.sql`

**Interfaces:**
- Produces: Linhas de `platform_commercial_terms` das organizações `avil`, `diego-souza` e `daludishop` com `starts_on = '2026-09-01'` e `setup_due_month = '2026-09-01'`, eventos em `platform_audit_events`.

- [ ] **Step 1: Criar o arquivo de migration com pré-condições incondicionais antes de qualquer DDL**

Criar `supabase/migrations/20260919160000_platform_terms_vigencia_setembro.sql`:

```sql
-- Migration: Ajuste de vigência inicial dos primeiros contratos de Avil, DSA e Daludi Shop para setembro/2026
-- Contexto: Contratos cadastrados em setembro/2026 foram salvos com starts_on = 2026-10-01
-- devido ao valor padrão do formulário anterior. Esta migration ajusta especificamente
-- as três organizações para 2026-09-01 para habilitar previsão e fechamento de 2026-09.

create or replace function pg_temp.executar_migracao_vigencia_setembro()
returns void
language plpgsql
as $$
declare
  v_expected_orgs integer;
  v_target_slug text;
  v_org_id uuid;
  v_term_count integer;
  v_term public.platform_commercial_terms%rowtype;
  v_corrigido record;
  v_slug_count integer;
begin
  -- 1. Pré-condição incondicional ANTES de qualquer DDL, lock ou alteração:
  select count(*) into v_expected_orgs
  from public.organizations
  where slug in ('avil', 'diego-souza', 'daludishop');

  -- Em ambiente limpo sem seeds de produção (ex.: suíte de testes isolada ou CI novo):
  if v_expected_orgs = 0 then
    -- No-op absoluto: encerra sem tocar no trigger, na tabela ou em qualquer lock
    return;
  end if;

  -- Se encontrou pelo menos uma organização alvo, EXIGE obrigatoriamente que as 3 existam
  if v_expected_orgs <> 3 then
    raise exception 'Pré-condição violada: esperava exatamente 3 organizações (avil, diego-souza, daludishop) ou nenhuma (ambiente limpo), mas encontrou %', v_expected_orgs
      using errcode = '23514';
  end if;

  -- 2. Somente após a pré-condição ser satisfeita, criar a tabela temporária e desabilitar o trigger:
  create temporary table _migracao_termos_corrigidos (
    id uuid primary key,
    org_id uuid not null,
    slug text not null,
    starts_on_anterior date not null,
    starts_on_atual date not null,
    setup_due_anterior date,
    setup_due_atual date
  ) on commit drop;

  alter table public.platform_commercial_terms disable trigger platform_commercial_terms_no_mutation;

  -- 3. Para cada organização alvo, validar individualmente e atualizar cirurgicamente
  for v_target_slug in select unnest(array['avil', 'diego-souza', 'daludishop']) loop
    select id into strict v_org_id
    from public.organizations
    where slug = v_target_slug;

    -- Validar que possui exatamente 1 termo no histórico total (contrato inaugural)
    select count(*) into strict v_term_count
    from public.platform_commercial_terms
    where org_id = v_org_id;

    if v_term_count <> 1 then
      raise exception 'Organização % possui % termos comerciais no histórico, esperava exatamente 1 (primeiro contrato inaugural)', v_target_slug, v_term_count
        using errcode = '23514';
    end if;

    -- Obter o termo inaugural
    select * into strict v_term
    from public.platform_commercial_terms
    where org_id = v_org_id;

    -- Validar que é versão 1 e estava com vigência em 2026-10-01
    if v_term.version <> 1 or v_term.starts_on <> '2026-10-01'::date then
      raise exception 'Termo da organização % não é o contrato inaugural esperado de 2026-10-01 (versão %, starts_on %)', v_target_slug, v_term.version, v_term.starts_on
        using errcode = '23514';
    end if;

    -- Atualizar especificamente esse termo único
    update public.platform_commercial_terms
    set starts_on = '2026-09-01',
        setup_due_month = case when setup_due_month = '2026-10-01' then '2026-09-01'::date else setup_due_month end
    where id = v_term.id and org_id = v_org_id
    returning id, org_id, starts_on, setup_due_month
    into v_corrigido;

    insert into _migracao_termos_corrigidos (
      id, org_id, slug, starts_on_anterior, starts_on_atual, setup_due_anterior, setup_due_atual
    ) values (
      v_corrigido.id,
      v_corrigido.org_id,
      v_target_slug,
      v_term.starts_on,
      v_corrigido.starts_on,
      v_term.setup_due_month,
      v_corrigido.setup_due_month
    );
  end loop;

  -- 4. Asserção LOUD: exatamente 3 linhas atualizadas no total
  if (select count(*) from _migracao_termos_corrigidos) <> 3 then
    raise exception 'Esperava exatamente 3 linhas em _migracao_termos_corrigidos, mas obteve %', (select count(*) from _migracao_termos_corrigidos)
      using errcode = '23514';
  end if;

  -- 5. Asserção LOUD: exatamente 1 linha por organização
  for v_target_slug in select unnest(array['avil', 'diego-souza', 'daludishop']) loop
    select count(*) into v_slug_count
    from _migracao_termos_corrigidos
    where slug = v_target_slug;

    if v_slug_count <> 1 then
      raise exception 'Esperava exatamente 1 linha corrigida para a organização %, mas obteve %', v_target_slug, v_slug_count
        using errcode = '23514';
    end if;
  end loop;

  -- 6. Asserção LOUD: nenhum termo restante em 2026-10 para as organizações alvo
  if exists (
    select 1
    from public.platform_commercial_terms t
    join public.organizations o on o.id = t.org_id
    where o.slug in ('avil', 'diego-souza', 'daludishop')
      and t.starts_on = '2026-10-01'
  ) then
    raise exception 'Restaram termos em 2026-10 para as organizações alvo' using errcode = '23514';
  end if;

  -- 7. Auditoria completa para cada termo modificado
  insert into public.platform_audit_events (org_id, actor_id, category, action, result, target, reason, details)
  select org_id, null, 'admin', 'platform_terms_vigencia_corrigida', 'success', id::text,
    'Ajuste de vigencia inicial: primeiro contrato inicia no mes do cadastro (2026-09)',
    jsonb_build_object(
      'org_slug', slug,
      'starts_on_anterior', starts_on_anterior,
      'starts_on_atual', starts_on_atual,
      'setup_due_month_anterior', setup_due_anterior,
      'setup_due_month_atual', setup_due_atual
    )
  from _migracao_termos_corrigidos;

  -- 8. Reabilitar o trigger incondicionalmente
  alter table public.platform_commercial_terms enable trigger platform_commercial_terms_no_mutation;
end;
$$;

select pg_temp.executar_migracao_vigencia_setembro();
```

- [ ] **Step 2: Adicionar testes completos para cenários 0, 1, 2 e 3 organizações na suite SQL**

Ao final de `supabase/tests/platform_commercial.sql`:

```sql
-- ============================================================================
-- Testes da migration 20260919160000_platform_terms_vigencia_setembro.sql:
-- ============================================================================

-- Cenário A: 0 organizações presentes -> No-op absoluto sem efeitos colaterais
create temporary table _check_zero_noop (
  terms_before integer not null,
  audits_before integer not null
);

insert into _check_zero_noop (terms_before, audits_before)
values (
  (select count(*) from public.platform_commercial_terms),
  (select count(*) from public.platform_audit_events)
);

\ir ../migrations/20260919160000_platform_terms_vigencia_setembro.sql

do $$
declare
  v_before record;
  v_terms_after integer;
  v_audits_after integer;
begin
  select * into strict v_before from _check_zero_noop;
  select count(*) into v_terms_after from public.platform_commercial_terms;
  select count(*) into v_audits_after from public.platform_audit_events;

  if v_terms_after <> v_before.terms_before or v_audits_after <> v_before.audits_before then
    raise exception 'Cenário 0 organizações violou o no-op: termos ou auditorias foram criados indevidamente';
  end if;
end $$;

drop table if exists _check_zero_noop;

-- Cenário B1: 1 organização presente (apenas avil) -> Executa migration e valida abort atômico com exceção 23514
do $$
declare
  v_abortou boolean := false;
begin
  insert into public.organizations (id, nome, slug) values
    ('90000000-0000-0000-0000-000000000061', 'Avil Parcial', 'avil')
  on conflict (slug) do nothing;

  insert into public.platform_commercial_terms (
    id, org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4,
    sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version
  ) values (
    'a0000000-0000-0000-0000-000000000061', '90000000-0000-0000-0000-000000000061',
    '2026-10-01'::date, 2, 0, 700, 600, 550, 500, 120, 300000, '2026-10-01'::date,
    'teste parcial 1 org', '80000000-0000-0000-0000-000000000001'::uuid, 1
  );

  begin
    perform pg_temp.executar_migracao_vigencia_setembro();
  exception when sqlstate '23514' then
    v_abortou := true;
  end;

  -- Limpar fixtures
  delete from public.platform_commercial_terms where id = 'a0000000-0000-0000-0000-000000000061';
  delete from public.organizations where id = '90000000-0000-0000-0000-000000000061';

  if not v_abortou then
    raise exception 'Migration não abortou quando apenas 1 organização estava presente';
  end if;
end $$;

-- Cenário B2: 2 organizações presentes (avil e diego-souza) -> Executa migration e valida abort atômico com exceção 23514
do $$
declare
  v_abortou boolean := false;
begin
  insert into public.organizations (id, nome, slug) values
    ('90000000-0000-0000-0000-000000000061', 'Avil Parcial', 'avil'),
    ('90000000-0000-0000-0000-000000000062', 'DSA Parcial', 'diego-souza')
  on conflict (slug) do nothing;

  insert into public.platform_commercial_terms (
    id, org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4,
    sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version
  ) values
    ('a0000000-0000-0000-0000-000000000061', '90000000-0000-0000-0000-000000000061',
     '2026-10-01'::date, 2, 0, 700, 600, 550, 500, 120, 300000, '2026-10-01'::date,
     'teste parcial 2 orgs', '80000000-0000-0000-0000-000000000001'::uuid, 1),
    ('a0000000-0000-0000-0000-000000000062', '90000000-0000-0000-0000-000000000062',
     '2026-10-01'::date, 2, 0, 700, 600, 550, 500, 120, 300000, '2026-10-01'::date,
     'teste parcial 2 orgs', '80000000-0000-0000-0000-000000000001'::uuid, 1);

  begin
    perform pg_temp.executar_migracao_vigencia_setembro();
  exception when sqlstate '23514' then
    v_abortou := true;
  end;

  -- Limpar fixtures
  delete from public.platform_commercial_terms where id in ('a0000000-0000-0000-0000-000000000061', 'a0000000-0000-0000-0000-000000000062');
  delete from public.organizations where id in ('90000000-0000-0000-0000-000000000061', '90000000-0000-0000-0000-000000000062');

  if not v_abortou then
    raise exception 'Migration não abortou quando apenas 2 organizações estavam presentes';
  end if;
end $$;

-- Cenário C: 3 organizações presentes + Tenant de Controle -> Migração e Readback Completo
insert into public.organizations (id, nome, slug) values
  ('90000000-0000-0000-0000-000000000051', 'Avil Teste', 'avil'),
  ('90000000-0000-0000-0000-000000000052', 'DSA Teste', 'diego-souza'),
  ('90000000-0000-0000-0000-000000000053', 'Daludi Shop Teste', 'daludishop'),
  ('90000000-0000-0000-0000-000000000054', 'Controle Teste', 'org-controle')
on conflict (slug) do nothing;

insert into public.platform_commercial_terms (
  id, org_id, starts_on, modality, monthly_fee_cents,
  revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4,
  sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version
)
select
  ('a0000000-0000-0000-0000-00000000000' || row_number() over())::uuid,
  o.id, '2026-10-01'::date, 2, 0, 700, 600, 550, 500, 120, 300000, '2026-10-01'::date,
  'fixture vigencia outubro', '80000000-0000-0000-0000-000000000001'::uuid, 1
from public.organizations o
where o.slug in ('avil', 'diego-souza', 'daludishop', 'org-controle');

\ir ../migrations/20260919160000_platform_terms_vigencia_setembro.sql

-- Asserção completa de readback:
do $$
declare
  v_term record;
  v_audit record;
  v_ctrl public.platform_commercial_terms%rowtype;
  v_slug text;
  v_found_count integer;
  v_trigger_blocked boolean := false;
begin
  -- 1. Validar alvos: starts_on e setup_due_month = 2026-09-01 via IS DISTINCT FROM
  for v_slug in select unnest(array['avil', 'diego-souza', 'daludishop'])
  loop
    select o.slug, t.id, t.starts_on, t.setup_due_month
    into strict v_term
    from public.platform_commercial_terms t
    join public.organizations o on o.id = t.org_id
    where o.slug = v_slug;

    if v_term.starts_on is distinct from '2026-09-01'::date
       or v_term.setup_due_month is distinct from '2026-09-01'::date then
      raise exception 'Falha no readback do alvo %: starts_on=%, setup_due_month=%',
        v_term.slug, v_term.starts_on, v_term.setup_due_month;
    end if;

    -- Validar evento de auditoria correlacionado individual para este slug
    select e.* into strict v_audit
    from public.platform_audit_events e
    join public.organizations o on o.id = e.org_id
    where o.slug = v_slug and e.action = 'platform_terms_vigencia_corrigida';

    if v_audit.category is distinct from 'admin'
       or v_audit.actor_id is distinct from null
       or v_audit.result is distinct from 'success'
       or v_audit.target is distinct from v_term.id::text
       or v_audit.reason is distinct from 'Ajuste de vigencia inicial: primeiro contrato inicia no mes do cadastro (2026-09)'
       or (v_audit.details->>'org_slug') is distinct from v_slug
       or (v_audit.details->>'starts_on_anterior') is distinct from '2026-10-01'
       or (v_audit.details->>'starts_on_atual') is distinct from '2026-09-01'
       or (v_audit.details->>'setup_due_month_anterior') is distinct from '2026-10-01'
       or (v_audit.details->>'setup_due_month_atual') is distinct from '2026-09-01' then
      raise exception 'Auditoria incompleta ou invalida para %: %', v_slug, v_audit;
    end if;
  end loop;

  -- 2. Validar controle: permaneceu 2026-10-01 e inalterado via SELECT INTO STRICT
  select t.* into strict v_ctrl
  from public.platform_commercial_terms t
  join public.organizations o on o.id = t.org_id
  where o.slug = 'org-controle';

  if v_ctrl.starts_on is distinct from '2026-10-01'::date
     or v_ctrl.setup_due_month is distinct from '2026-10-01'::date
     or v_ctrl.modality is distinct from 2
     or v_ctrl.monthly_fee_cents is distinct from 0
     or v_ctrl.sonar_unit_cents is distinct from 120
     or v_ctrl.setup_fee_cents is distinct from 300000 then
    raise exception 'Tenant controle foi alterado indevidamente: %', v_ctrl;
  end if;

  if exists (
    select 1
    from public.platform_audit_events e
    join public.organizations o on o.id = e.org_id
    where o.slug = 'org-controle'
  ) then
    raise exception 'Tenant controle recebeu auditoria indevida';
  end if;

  -- 3. Validar total de auditorias
  select count(*) into strict v_found_count
  from public.platform_audit_events
  where action = 'platform_terms_vigencia_corrigida';

  if v_found_count is distinct from 3 then
    raise exception 'Esperava exatamente 3 auditorias, encontrou %', v_found_count;
  end if;

  -- 4. Validar trigger de imutabilidade ativo sem falso positivo
  begin
    update public.platform_commercial_terms set reason = 'tentativa ilegal'
    where starts_on = '2026-09-01';
  exception when sqlstate '23514' then
    v_trigger_blocked := true;
  end;

  if not v_trigger_blocked then
    raise exception 'Trigger de imutabilidade falhou ao bloquear update direto';
  end if;
end $$;

-- Limpeza final da função temporária
drop function if exists pg_temp.executar_migracao_vigencia_setembro();
```

- [ ] **Step 3: Executar a suite SQL para validar fixtures e readback**

Run: `psql -U supabase_admin -d codex_platform_admin_test_20260906 -v ON_ERROR_STOP=1 -f supabase/tests/platform_commercial.sql`
Expected: 0 erros, script finaliza com sucesso.

- [ ] **Step 4: Commit da Task 1**

```bash
git add supabase/migrations/20260919160000_platform_terms_vigencia_setembro.sql supabase/tests/platform_commercial.sql
git commit -m "fix(db): migration cirurgica de ajuste de vigencia inicial dos termos para 2026-09"
```

---

### Task 2: Atualização do Formulário `CommercialTermsForm` no Frontend com Clamping, Sanitização e Sincronização Dinâmica

**Files:**
- Modify: `src/components/platform-admin/commercial-terms-form.tsx`
- Test / Modify: `src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`

**Interfaces:**
- Consumes: `currentMonthStart()`, `nextMonthStart()`
- Produces: `startsOn` padrão sendo `currentMonthStart()`, clamping automático de `setupDueMonth` quando `startsOn` avança para o próximo mês, sanitização rigorosa no `submit` com mapeamento explícito de `setup_due_month: effectiveSetupDue`, e prevenção contra formulário estagnado na virada do mês cobrindo `02:59Z → 03:01Z` (Fortaleza) tanto em `focus` (envolvido em `act()`) quanto no `submit`.

- [ ] **Step 1: Atualizar testes de unidade no frontend**

Em `src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`:
1. Importar `act` de `@testing-library/react`.
2. Substituir o teste existente `salva modalidade 2, infraestrutura e vigência no próximo mês` (linha 50, que esperava `starts_on: '2026-10-01'` por padrão) por `salva primeiro contrato iniciando no mês corrente por padrão com setup_due_month correspondente`.
3. Adicionar teste de clamping ao selecionar explicitamente o próximo mês.
4. Adicionar teste de sanitização no submit contra input manual defasado de mês de implantação.
5. Adicionar teste defensivo de virada de mês no evento de `focus` cruzando `2026-10-01T02:59:00Z → 2026-10-01T03:01:00Z` (meia-noite de Fortaleza) com `act()`, validando `startsOn`, `setupDueMonth` e mensagem de erro na UI.
6. Adicionar teste defensivo de virada de mês no evento de `submit` cruzando `2026-10-01T02:59:00Z → 2026-10-01T03:01:00Z`, validando que bloqueia o salvamento e atualiza `startsOn`, `setupDueMonth` e mensagem de erro na UI.

```tsx
  it('salva primeiro contrato iniciando no mês corrente por padrão com setup_due_month correspondente', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Modalidade'), '2');
    await user.clear(screen.getByLabelText('Sonar por consulta'));
    await user.type(screen.getByLabelText('Sonar por consulta'), '600,00');
    await user.type(screen.getByLabelText('Motivo'), 'novo contrato');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-a',
      modality: 2,
      monthly_fee_cents: 0,
      sonar_unit_cents: 60_000,
      starts_on: '2026-09-01',
      setup_due_month: '2026-09',
    }));
  });

  it('ao selecionar próximo mês, ajusta setup_due_month para não anteceder a vigência', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Início da vigência'), '2026-10-01');
    await user.type(screen.getByLabelText('Motivo'), 'início futuro');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-a',
      starts_on: '2026-10-01',
      setup_due_month: '2026-10',
    }));
  });

  it('sanitiza setup_due_month no submit para nunca anteceder starts_on mesmo se o input for alterado manualmente', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    // Seleciona vigencia para o proximo mes (2026-10-01)
    await user.selectOptions(screen.getByLabelText('Início da vigência'), '2026-10-01');

    // Simula alteracao manual no campo Mes da implantacao de volta para 2026-09
    const setupInput = screen.getByLabelText('Mês da implantação');
    await user.clear(setupInput);
    await user.type(setupInput, '2026-09');

    await user.type(screen.getByLabelText('Motivo'), 'teste sanitizacao');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    // Comprova que o payload final submetido aplicou o clamping para 2026-10
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-a',
      starts_on: '2026-10-01',
      setup_due_month: '2026-10',
    }));
  });

  it('atualiza vigência, ajusta setup_due_month e alerta ao focar na janela se a virada do mês em Fortaleza ocorrer com formulário aberto', async () => {
    // 2026-10-01T02:59:00Z corresponde a 2026-09-30 23:59:00 em America/Fortaleza
    vi.setSystemTime(new Date('2026-10-01T02:59:00Z'));
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('Início da vigência')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Mês da implantação')).toHaveValue('2026-09');

    // 2026-10-01T03:01:00Z corresponde a 2026-10-01 00:01:00 em America/Fortaleza (virou o mês!)
    vi.setSystemTime(new Date('2026-10-01T03:01:00Z'));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(screen.getByLabelText('Início da vigência')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Mês da implantação')).toHaveValue('2026-10');
    expect(screen.getByText(/A competência do mês virou/)).toBeInTheDocument();
  });

  it('rejeita vigência obsoleta, atualiza estado para novo mês e alerta se a virada do mês em Fortaleza ocorrer antes do submit', async () => {
    vi.setSystemTime(new Date('2026-10-01T02:59:00Z'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('Início da vigência')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Mês da implantação')).toHaveValue('2026-09');

    // Simula passagem do tempo para o mês seguinte em Fortaleza
    vi.setSystemTime(new Date('2026-10-01T03:01:00Z'));

    await user.type(screen.getByLabelText('Motivo'), 'contrato no limite do mes');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    // Salvar não deve ter sido executado com dados passados
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Início da vigência')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Mês da implantação')).toHaveValue('2026-10');
    expect(screen.getByText(/A competência do mês virou/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Rodar teste para confirmar falha**

Run: `pnpm test src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar em `commercial-terms-form.tsx`**

1. Estado dinâmico e função de sincronização de virada de mês:
   ```typescript
   const isFirstContract = current === null;
   const [startsOn, setStartsOn] = useState(() => currentMonthStart());
   const effectiveStartsOn = isFirstContract ? startsOn : nextMonthStart();
   const today = useMemo(() => todayInFortaleza(), []);
   const [form, setForm] = useState<FormState>(() => initialState(current, effectiveStartsOn));
   const [error, setError] = useState<string | null>(null);
   const revenueTouched = useRef(false);

   function syncMonthRollover(nowMonth: string) {
     setStartsOn(nowMonth);
     const minSetupMonth = nowMonth.slice(0, 7);
     setForm((previous) => ({
       ...previous,
       setupDueMonth: previous.setupDueMonth && previous.setupDueMonth < minSetupMonth
         ? minSetupMonth
         : previous.setupDueMonth,
     }));
     setError('A competência do mês virou enquanto o formulário estava aberto. A vigência foi ajustada para o mês atual. Revise e confirme o salvamento.');
   }

   useEffect(() => {
     const month = currentMonthStart();
     setStartsOn(month);
     setForm(initialState(current, month));
     revenueTouched.current = false;
     setError(null);
   }, [current, orgId]);

   useEffect(() => {
     function syncOnFocus() {
       const nowMonth = currentMonthStart();
       if (isFirstContract && startsOn < nowMonth) {
         syncMonthRollover(nowMonth);
       }
     }
     window.addEventListener('focus', syncOnFocus);
     return () => window.removeEventListener('focus', syncOnFocus);
   }, [isFirstContract, startsOn]);
   ```

2. No `onChange` do select de vigência, aplicar clamping no `setupDueMonth`:
   ```typescript
   onChange={(event) => {
     const newStartsOn = event.target.value;
     setStartsOn(newStartsOn);
     const minSetupMonth = newStartsOn.slice(0, 7);
     setForm((previous) => {
       if (previous.setupDueMonth && previous.setupDueMonth < minSetupMonth) {
         return { ...previous, setupDueMonth: minSetupMonth };
       }
       return previous;
     });
   }}
   ```

3. No `submit`, verificar virada de competência e conectar explicitamente `setup_due_month: effectiveSetupDue`:
   ```typescript
   const nowCurrentMonth = currentMonthStart();
   if (isFirstContract && startsOn < nowCurrentMonth) {
     syncMonthRollover(nowCurrentMonth);
     return;
   }

   const effectiveSetupDue = isFirstContract
     ? (form.setupDueMonth && form.setupDueMonth < effectiveStartsOn.slice(0, 7)
         ? effectiveStartsOn.slice(0, 7)
         : form.setupDueMonth || null)
     : null;

   await save.mutateAsync({
     org_id: orgId,
     starts_on: effectiveStartsOn,
     modality: Number(form.modality) as 1 | 2,
     monthly_fee_cents: form.modality === '2' ? 0 : monthly!,
     revenue_bps_t1: revenueT1!,
     revenue_bps_t2: revenueT2!,
     revenue_bps_t3: revenueT3!,
     revenue_bps_t4: revenueT4!,
     sonar_unit_cents: form.modality === '1' ? 0 : sonar!,
     setup_fee_cents: isFirstContract ? setup! : 0,
     setup_due_month: effectiveSetupDue,
     reason: form.reason.trim(),
   });
   ```

4. Atualizar opções do `<select>` para exibir `currentMonthStart()` em primeiro lugar e atualizar o texto explicativo:
   ```tsx
   <select
     aria-label="Início da vigência"
     className="h-9 w-full rounded-md border border-input bg-transparent px-3"
     value={startsOn}
     onChange={...}
   >
     <option value={currentMonthStart()}>Este mês ({currentMonthStart()})</option>
     <option value={nextMonthStart()}>Próximo mês ({nextMonthStart()})</option>
   </select>
   ```

- [ ] **Step 4: Rodar testes do frontend para confirmar aprovação**

Run: `pnpm test src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit da Task 2**

```bash
git add src/components/platform-admin/commercial-terms-form.tsx src/components/platform-admin/__tests__/commercial-terms-form.test.tsx
git commit -m "feat(admin): define vigencia no mes corrente como padrao com clamping de setup_due_month"
```

---

### Task 3: Validação de Qualidade, Integridade e Documentação

**Files:**
- Modify: `obsidian-vault/09-Logs/Changelog.md`
- Modify: `docs/project-status.md`

- [ ] **Step 1: Rodar typecheck do projeto**

Run: `npx tsc -b --force`
Expected: 0 erros.

- [ ] **Step 2: Rodar lint dos arquivos alterados**

Run: `pnpm eslint src/components/platform-admin/commercial-terms-form.tsx src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`
Expected: 0 warnings, 0 erros.

- [ ] **Step 3: Rodar todos os testes de platform-admin**

Run: `pnpm test src/components/platform-admin`
Expected: Todos passando.

- [ ] **Step 4: Executar a suite SQL completa**

Run: `psql -U supabase_admin -d codex_platform_admin_test_20260906 -v ON_ERROR_STOP=1 -f supabase/tests/platform_commercial.sql`
Expected: 0 erros, todos os testes e assertions passando.

- [ ] **Step 5: Registrar decisão e exceção documental**

Em `obsidian-vault/09-Logs/Changelog.md` e `docs/project-status.md`, registrar a entrada de 2026-09-19 documentando a exceção autorizada e o ajuste das três organizações (Avil, DSA, Daludi Shop) para vigência em 2026-09-01, permitindo a apuração e fechamento da competência de setembro.

- [ ] **Step 6: Commit da Task 3**

```bash
git add obsidian-vault/09-Logs/Changelog.md docs/project-status.md
git commit -m "docs(cobranca): registra ajuste de vigencia das 3 organizacoes e novo padrao de cadastro"
```
