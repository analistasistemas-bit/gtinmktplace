# Vigência Imediata no Cadastro de Condições Comerciais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alterar o comportamento do cadastro de condições comerciais para que o primeiro contrato inicie por padrão no mês corrente (em vez de no próximo mês) e corrigir retroativamente a vigência das 3 organizações existentes (Avil, DSA, Daludi Shop) para 2026-09.

**Architecture:** Uma migration SQL pontual desabilita o trigger de imutabilidade, atualiza os termos existentes das 3 organizações de `2026-10-01` para `2026-09-01` (com registro em `platform_audit_events`), e o componente React `CommercialTermsForm` passa a inicializar `startsOn` e `setupDueMonth` com o mês corrente, exibindo "Este mês" como primeira opção no seletor.

**Tech Stack:** Supabase PostgreSQL (PL-pgSQL), React, TypeScript, Vitest, Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-19-condicoes-comerciais-vigencia-cadastro-design.md](../specs/2026-09-19-condicoes-comerciais-vigencia-cadastro-design.md)

## Global Constraints

- Banco de dados: Supabase PostgreSQL (confirmado pelo operador).
- Apenas o primeiro contrato (`current === null`) inicia por padrão no mês corrente; renegociações continuam valendo a partir do próximo mês (`v_next_month`).
- A tabela `platform_commercial_terms` é imutável via trigger `platform_commercial_terms_no_mutation`; a migration deve desabilitar o trigger estritamente durante o UPDATE e reabilitá-lo na mesma transação.
- Toda alteração nos termos existentes deve ser registrada em `platform_audit_events`.
- Proibido deploy automático via insforge; esperar comando do usuário.

---

### Task 1: Migration SQL de Correção de Vigência para Setembro/2026

**Files:**
- Create: `supabase/migrations/20260919130000_platform_terms_vigencia_setembro.sql`
- Modify: `supabase/tests/platform_commercial.sql`

**Interfaces:**
- Produces: Linhas de `platform_commercial_terms` com `starts_on = '2026-09-01'` e `setup_due_month = '2026-09-01'` para as organizações com termos criados para 2026-10-01.

- [ ] **Step 1: Criar o arquivo de migration**

Criar `supabase/migrations/20260919130000_platform_terms_vigencia_setembro.sql`:

```sql
-- Migration: Ajuste de vigência inicial dos primeiros contratos para setembro/2026
-- Contexto: Contratos cadastrados em setembro/2026 foram salvos com starts_on = 2026-10-01
-- devido ao valor padrão do formulário anterior. Esta migration ajusta starts_on e
-- setup_due_month para 2026-09-01 para habilitar previsão e fechamento de 2026-09.

begin;

alter table public.platform_commercial_terms disable trigger platform_commercial_terms_no_mutation;

with corrigidos as (
  update public.platform_commercial_terms
  set starts_on = '2026-09-01',
      setup_due_month = case when setup_due_month = '2026-10-01' then '2026-09-01'::date else setup_due_month end
  where starts_on = '2026-10-01'
  returning id, org_id
)
insert into public.platform_audit_events (org_id, actor_id, category, action, result, target, reason, details)
select org_id, null, 'admin', 'platform_terms_vigencia_corrigida', 'success', id::text,
  'Ajuste de vigencia inicial: primeiro contrato inicia no mes do cadastro (2026-09)',
  jsonb_build_object('starts_on_anterior', '2026-10-01', 'starts_on_atual', '2026-09-01')
from corrigidos;

alter table public.platform_commercial_terms enable trigger platform_commercial_terms_no_mutation;

commit;
```

- [ ] **Step 2: Adicionar chamada na suite de testes SQL**

Adicionar `\ir ../migrations/20260919130000_platform_terms_vigencia_setembro.sql` em `supabase/tests/platform_commercial.sql` logo após a última migration incluída.

- [ ] **Step 3: Commit da Task 1**

```bash
git add supabase/migrations/20260919130000_platform_terms_vigencia_setembro.sql supabase/tests/platform_commercial.sql
git commit -m "fix(db): migration de ajuste de vigencia inicial dos termos para 2026-09"
```

---

### Task 2: Atualização do Formulário `CommercialTermsForm` no Frontend

**Files:**
- Modify: `src/components/platform-admin/commercial-terms-form.tsx:100-118,325-348`
- Test / Modify: `src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`

**Interfaces:**
- Consumes: `currentMonthStart()`, `nextMonthStart()`
- Produces: `startsOn` padrão sendo `currentMonthStart()`, `<select>` com "Este mês" em primeiro lugar.

- [ ] **Step 1: Escrever teste falhando no frontend**

Em `src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`:
Atualizar o teste de criação para verificar que ao abrir o formulário sem selecionar nada, o padrão enviado é o mês corrente (`2026-09-01`):

```tsx
  it('salva primeiro contrato iniciando no mês corrente por padrão', async () => {
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
    }));
  });

  it('permite primeiro contrato selecionando explicitamente o próximo mês', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Início da vigência'), '2026-10-01');
    await user.type(screen.getByLabelText('Motivo'), 'início futuro');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-a',
      starts_on: '2026-10-01',
    }));
  });
```

- [ ] **Step 2: Rodar teste para confirmar falha**

Run: `pnpm test src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`
Expected: FAIL (pois o código atual ainda inicializa com `2026-10-01`).

- [ ] **Step 3: Implementar a alteração em `commercial-terms-form.tsx`**

1. Em `commercial-terms-form.tsx`:
   - Trocar a inicialização de `startsOn`:
     ```typescript
     const [startsOn, setStartsOn] = useState(currentMonth);
     const effectiveStartsOn = isFirstContract ? startsOn : nextMonth;
     ```
   - No `useEffect`:
     ```typescript
     useEffect(() => {
       setStartsOn(currentMonth);
       setForm(initialState(current, currentMonth));
       revenueTouched.current = false;
       setError(null);
     }, [current, orgId, currentMonth]);
     ```
   - No `<select aria-label="Início da vigência">`:
     ```tsx
     <option value={currentMonth}>Este mês ({currentMonth})</option>
     <option value={nextMonth}>Próximo mês ({nextMonth})</option>
     ```
   - No texto explicativo:
     `Primeiro contrato inicia neste mês. Padrão: este mês. Vigência selecionada: {effectiveStartsOn}.`

- [ ] **Step 4: Rodar teste para confirmar passagem**

Run: `pnpm test src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit da Task 2**

```bash
git add src/components/platform-admin/commercial-terms-form.tsx src/components/platform-admin/__tests__/commercial-terms-form.test.tsx
git commit -m "feat(admin): define vigencia no mes corrente como padrao no cadastro de condicoes comerciais"
```

---

### Task 3: Validação de Qualidade e Integridade Geral

**Files:**
- Scope: todo o repositório

- [ ] **Step 1: Rodar typecheck do frontend**

Run: `pnpm typecheck`
Expected: 0 erros.

- [ ] **Step 2: Rodar lint dos arquivos alterados**

Run: `pnpm eslint src/components/platform-admin/commercial-terms-form.tsx src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`
Expected: 0 warnings, 0 erros.

- [ ] **Step 3: Rodar todos os testes de platform-admin**

Run: `pnpm test src/components/platform-admin`
Expected: Todos passando.
