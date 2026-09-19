# Vigência Imediata no Cadastro de Condições Comerciais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alterar o comportamento do cadastro de condições comerciais para que o primeiro contrato inicie por padrão no mês corrente (em vez de no próximo mês) e corrigir cirurgicamente a vigência das 3 organizações existentes (Avil, DSA, Daludi Shop) para 2026-09.

**Architecture:** Uma migration SQL pontual e restrita aos slugs alvo (`avil`, `diego-souza`, `daludishop`) desabilita temporariamente o trigger de imutabilidade, atualiza os termos de `2026-10-01` para `2026-09-01` (com auditoria detalhada de `starts_on` e `setup_due_month` e asserção LOUD pós-condição de contagem exata e ausência de resíduos), e o componente React `CommercialTermsForm` passa a inicializar com o mês corrente, aplicando clamping automático no `setupDueMonth` ao alternar opções de vigência.

**Tech Stack:** Supabase PostgreSQL (PL-pgSQL), React, TypeScript, Vitest, Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-19-condicoes-comerciais-vigencia-cadastro-design.md](../specs/2026-09-19-condicoes-comerciais-vigencia-cadastro-design.md)

## Global Constraints

- Banco de dados: Supabase PostgreSQL (confirmado pelo operador).
- Apenas o primeiro contrato (`current === null`) inicia por padrão no mês corrente; renegociações continuam valendo a partir do próximo mês (`v_next_month`).
- A migration SQL deve filtrar estritamente pelos slugs das 3 organizações afetadas (`avil`, `diego-souza`, `daludishop`), nunca fazer UPDATE indiscriminado por data.
- Clamping obrigatório no frontend: se o usuário selecionar "Próximo mês", `setupDueMonth` deve acompanhar e nunca anteceder `startsOn`.
- O trigger `platform_commercial_terms_no_mutation` deve ser reabilitado na mesma transação.
- Proibido deploy automático via insforge; esperar comando do usuário.

---

### Task 1: Migration SQL de Correção Cirúrgica de Vigência para Setembro/2026

**Files:**
- Create: `supabase/migrations/20260919130000_platform_terms_vigencia_setembro.sql`
- Modify: `supabase/tests/platform_commercial.sql`

**Interfaces:**
- Produces: Linhas de `platform_commercial_terms` das organizações `avil`, `diego-souza` e `daludishop` com `starts_on = '2026-09-01'` e `setup_due_month = '2026-09-01'`, eventos em `platform_audit_events`.

- [ ] **Step 1: Criar o arquivo de migration**

Criar `supabase/migrations/20260919130000_platform_terms_vigencia_setembro.sql`:

```sql
-- Migration: Ajuste de vigência inicial dos primeiros contratos de Avil, DSA e Daludi Shop para setembro/2026
-- Contexto: Contratos cadastrados em setembro/2026 foram salvos com starts_on = 2026-10-01
-- devido ao valor padrão do formulário anterior. Esta migration ajusta especificamente
-- as três organizações para 2026-09-01 para habilitar previsão e fechamento de 2026-09.

begin;

alter table public.platform_commercial_terms disable trigger platform_commercial_terms_no_mutation;

with target_orgs as (
  select id, slug from public.organizations where slug in ('avil', 'diego-souza', 'daludishop')
),
corrigidos as (
  update public.platform_commercial_terms t
  set starts_on = '2026-09-01',
      setup_due_month = case when t.setup_due_month = '2026-10-01' then '2026-09-01'::date else t.setup_due_month end
  from target_orgs o
  where t.org_id = o.id
    and t.starts_on = '2026-10-01'
  returning t.id, t.org_id, o.slug,
            '2026-10-01'::date as starts_on_anterior,
            t.starts_on as starts_on_atual,
            (case when t.setup_due_month = '2026-09-01' then '2026-10-01'::date else t.setup_due_month end) as setup_due_anterior,
            t.setup_due_month as setup_due_atual
)
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
from corrigidos;

alter table public.platform_commercial_terms enable trigger platform_commercial_terms_no_mutation;

-- Asserção LOUD pós-condição: valida o conjunto exato
do $$
declare
  v_expected_count integer;
  v_actual_count integer;
begin
  select count(*) into v_expected_count
  from public.organizations
  where slug in ('avil', 'diego-souza', 'daludishop');

  if v_expected_count = 3 then
    select count(*) into v_actual_count
    from public.platform_commercial_terms t
    join public.organizations o on o.id = t.org_id
    where o.slug in ('avil', 'diego-souza', 'daludishop')
      and t.starts_on = '2026-09-01';

    if v_actual_count <> 3 then
      raise exception 'Esperava 3 termos corrigidos para 2026-09-01, mas encontrou %', v_actual_count using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.platform_commercial_terms t
      join public.organizations o on o.id = t.org_id
      where o.slug in ('avil', 'diego-souza', 'daludishop')
        and t.starts_on = '2026-10-01'
    ) then
      raise exception 'Restaram termos em 2026-10 para as organizacoes alvo' using errcode = '23514';
    end if;
  end if;
end $$;

commit;
```

- [ ] **Step 2: Adicionar fixtures e testes na suite SQL**

Em `supabase/tests/platform_commercial.sql`:
1. Inserir fixtures das 3 organizações alvo (`avil`, `diego-souza`, `daludishop`) com termos salvos com `starts_on = '2026-10-01'`.
2. Inserir organização de controle `org-controle` com `starts_on = '2026-10-01'`.
3. Adicionar `\ir ../migrations/20260919130000_platform_terms_vigencia_setembro.sql`.
4. Validar via bloco `do $$`:
   - `avil`, `diego-souza` e `daludishop` têm `starts_on = '2026-09-01'`.
   - `org-controle` manteve `starts_on = '2026-10-01'`.
   - 3 registros de auditoria foram gravados em `platform_audit_events`.
   - O trigger `platform_commercial_terms_no_mutation` impede update direto (tenta update direto e captura exception).

- [ ] **Step 3: Commit da Task 1**

```bash
git add supabase/migrations/20260919130000_platform_terms_vigencia_setembro.sql supabase/tests/platform_commercial.sql
git commit -m "fix(db): migration cirurgica de ajuste de vigencia inicial dos termos para 2026-09"
```

---

### Task 2: Atualização do Formulário `CommercialTermsForm` no Frontend com Clamping

**Files:**
- Modify: `src/components/platform-admin/commercial-terms-form.tsx:100-118,325-348`
- Test / Modify: `src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`

**Interfaces:**
- Consumes: `currentMonthStart()`, `nextMonthStart()`
- Produces: `startsOn` padrão sendo `currentMonthStart()`, clamping automático de `setupDueMonth` quando `startsOn` avança para o próximo mês.

- [ ] **Step 1: Escrever testes cobrindo padrão e clamping de `setup_due_month`**

Em `src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`:
1. Testar que no primeiro contrato sem interação na vigência, `starts_on` é `2026-09-01` e `setup_due_month` é `2026-09`.
2. Testar que ao selecionar "Próximo mês" (`2026-10-01`), `setup_due_month` é automaticamente ajustado para `2026-10` (não viola `setup_due_month >= starts_on`).

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
```

- [ ] **Step 2: Rodar teste para confirmar falha**

Run: `pnpm test src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar em `commercial-terms-form.tsx`**

1. Inicializar `startsOn` com `currentMonth`.
2. No `onChange` do select de vigência:
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
3. No `submit`:
   ```typescript
   const effectiveSetupDue = isFirstContract
     ? (form.setupDueMonth && form.setupDueMonth < effectiveStartsOn.slice(0, 7)
         ? effectiveStartsOn.slice(0, 7)
         : form.setupDueMonth || null)
     : null;
   ```
4. Atualizar opções do `<select>` para exibir `currentMonth` em primeiro lugar e atualizar o texto explicativo.

- [ ] **Step 4: Rodar testes do frontend para confirmar aprovação**

Run: `pnpm test src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit da Task 2**

```bash
git add src/components/platform-admin/commercial-terms-form.tsx src/components/platform-admin/__tests__/commercial-terms-form.test.tsx
git commit -m "feat(admin): define vigencia no mes corrente como padrao com clamping de setup_due_month"
```

---

### Task 3: Validação de Qualidade e Integridade

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

- [ ] **Step 4: Registrar decisão e exceção documental**

Em `obsidian-vault/09-Logs/Changelog.md` e `docs/project-status.md`, registrar a entrada de 2026-09-19 documentando a exceção autorizada e o ajuste das três organizações (Avil, DSA, Daludi Shop) para vigência em 2026-09-01, permitindo a apuração e fechamento da competência de setembro.

- [ ] **Step 5: Commit da Task 3**

```bash
git add obsidian-vault/09-Logs/Changelog.md docs/project-status.md
git commit -m "docs(cobranca): registra ajuste de vigencia das 3 organizacoes e novo padrao de cadastro"
```
