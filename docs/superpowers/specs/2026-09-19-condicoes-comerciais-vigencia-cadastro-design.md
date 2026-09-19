# Especificação de Design — Vigência Imediata no Cadastro de Condições Comerciais

**Data:** 2026-09-19  
**Status:** Aprovado para planejamento (Revisado pós-Adversarial Codex)  
**Autor:** Diego / Antigravity  
**Contexto:** Menu Organizações (`/admin`) e Detalhe da Organização (`/admin/organizacoes/:id`)

---

## 1. Contexto e Motivação

Na Central de Organizações (`/admin`), ao selecionar a competência corrente (`2026-09`), as três organizações cadastradas (**Avil**, **DSA** e **Daludi Shop**) apresentam os seguintes sintomas:
1. Alertas na faixa "Precisa da sua atenção":
   - `Avil: 2026-09 não fecha — condição comercial começa em 2026-10`
   - `DSA: 2026-09 não fecha — condição comercial começa em 2026-10`
   - `Daludi Shop: 2026-09 não fecha — condição comercial começa em 2026-10`
2. No KPI "Previsão de cobrança": valor `—` com o descritivo `"3 com vigência futura — fora do total"`.
3. Na tabela da carteira: a coluna de previsão fica vazia (`—`) e o badge sob o nome exibe `"Vigência em 2026-10"`.

### Causa Raiz

No componente `CommercialTermsForm` (`src/components/platform-admin/commercial-terms-form.tsx`), ao preencher as condições comerciais de um novo contrato (`current === null`), o estado inicial da vigência (`startsOn`) vinha pré-configurado como `nextMonth` (`nextMonthStart()`). O elemento `<select>` exibia "Próximo mês" como primeira opção e o texto informativo reforçava "Padrão: próximo mês".

Ao cadastrar os contratos das três organizações em setembro, a condição comercial foi salva com `starts_on = '2026-10-01'` e `setup_due_month = '2026-10-01'`. Como a função `platform_resolve_terms` filtra `starts_on <= competência`, a competência `2026-09` fica sem nenhum termo comercial vigente, impedindo o fechamento e a previsão de cobrança para o mês corrente.

---

## 2. Objetivos e Requisitos

### 2.1 Requisitos Funcionais

1. **Padrão no primeiro cadastro (Frontend):**
   - Ao cadastrar as condições comerciais pela primeira vez (`current === null`), o início da vigência (`startsOn`) deve ser por padrão **o mês corrente** (`currentMonthStart()`).
   - O `<select>` de início de vigência deve exibir `"Este mês (AAAA-MM-01)"` como primeira opção selecionada por padrão.
   - O texto descritivo deve informar que o padrão do primeiro contrato é o mês corrente.
   - O mês padrão da taxa de implantação (`setupDueMonth`) no estado inicial deve ser o mês corrente (`startsOn.slice(0, 7)`).
   - **Clamping de vigência e implantação:** Caso o operador selecione explicitamente "Próximo mês" (`startsOn` avançando para `AAAA-MM+1`), o campo `setupDueMonth` deve ser automaticamente ajustado caso seja menor que `startsOn.slice(0, 7)`, garantindo que nunca seja enviado um payload que viole a constraint `setup_due_month >= starts_on`.
2. **Renegociações futuras mantidas:**
   - A regra de renegociação permanece inalterada: contratos posteriores para organizações que já possuem termo comercial continuam valendo a partir do próximo mês (`effectiveStartsOn = nextMonth`), preservando a estabilidade da competência em andamento.
3. **Correção cirúrgica e segura dos dados existentes (Backend / Supabase PostgreSQL):**
   - Criar migration para atualizar estritamente as organizações alvo (**Avil** `slug='avil'`, **DSA** `slug='diego-souza'` e **Daludi Shop** `slug='daludishop'`).
   - Jamais fazer UPDATE irrestrito por data (`where starts_on = '2026-10-01'`), protegendo quaisquer outros tenants ou futuras renegociações legítimas de outubro.
   - Ajustar `starts_on = '2026-09-01'` e `setup_due_month` de `'2026-10-01'` para `'2026-09-01'`.
   - O trigger de imutabilidade `platform_commercial_terms_no_mutation` deve ser desabilitado estritamente durante a transação e reabilitado antes do commit.
   - Gerar evento completo de auditoria em `platform_audit_events` com categoria `'admin'`, ação `'platform_terms_vigencia_corrigida'`, registrando `starts_on_anterior`, `starts_on_atual`, `setup_due_month_anterior`, `setup_due_month_atual` e `org_slug`.
   - Incluir asserção LOUD (readback) confirmando que nenhuma das organizações alvo permaneceu em `2026-10` e nenhum outro tenant foi modificado.

### 2.2 Requisitos Não-Funcionais

1. **Cirúrgico e sem efeitos colaterais:** Não alterar a lógica de cálculo de faturamento, conciliações ou faixas de receita (`revenue_bps_t1..t4`).
2. **Testabilidade:**
   - Testes unitários do frontend (`src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`) cobrindo:
     a) Primeiro contrato com vigência padrão no mês corrente (`starts_on` e `setup_due_month`).
     b) Primeiro contrato com seleção de "Próximo mês", garantindo clamping de `setup_due_month`.
   - Teste SQL em `supabase/tests/platform_commercial.sql` com fixtures e verificação de readback e tenant controle.

---

## 3. Arquitetura e Detalhamento das Alterações

### 3.1 Frontend: `src/components/platform-admin/commercial-terms-form.tsx`

1. **Valores iniciais e clamping:**
   ```typescript
   const currentMonth = useMemo(() => currentMonthStart(), []);
   const nextMonth = useMemo(() => nextMonthStart(), []);
   const isFirstContract = current === null;
   const [startsOn, setStartsOn] = useState(currentMonth);
   const effectiveStartsOn = isFirstContract ? startsOn : nextMonth;

   useEffect(() => {
     setStartsOn(currentMonth);
     setForm(initialState(current, currentMonth));
     revenueTouched.current = false;
     setError(null);
   }, [current, orgId, currentMonth]);
   ```
2. **Mudança de `startsOn` com clamping de `setupDueMonth`:**
   Ao selecionar um novo `startsOn`:
   ```typescript
   onChange={(event) => {
     const newStartsOn = event.target.value;
     setStartsOn(newStartsOn);
     const minSetupMonth = newStartsOn.slice(0, 7);
     setForm((prev) => {
       if (prev.setupDueMonth && prev.setupDueMonth < minSetupMonth) {
         return { ...prev, setupDueMonth: minSetupMonth };
       }
       return prev;
     });
   }}
   ```
3. **No submit:**
   Garantir sanitização adicional caso o usuário tenha manipulado os campos:
   ```typescript
   const effectiveSetupDue = isFirstContract
     ? (form.setupDueMonth && form.setupDueMonth < effectiveStartsOn.slice(0, 7)
         ? effectiveStartsOn.slice(0, 7)
         : form.setupDueMonth || null)
     : null;
   ```
4. **Opções do `<select>` no primeiro contrato:**
   ```tsx
   <select
     aria-label="Início da vigência"
     className="h-9 w-full rounded-md border border-input bg-transparent px-3"
     value={startsOn}
     onChange={...}
   >
     <option value={currentMonth}>Este mês ({currentMonth})</option>
     <option value={nextMonth}>Próximo mês ({nextMonth})</option>
   </select>
   ```

### 3.2 Banco de Dados: Migration Supabase

Arquivo: `supabase/migrations/20260919130000_platform_terms_vigencia_setembro.sql`

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

-- Asserção LOUD: se restou qualquer linha alvo com starts_on = 2026-10-01, aborta
do $$
begin
  if exists (
    select 1
    from public.platform_commercial_terms t
    join public.organizations o on o.id = t.org_id
    where o.slug in ('avil', 'diego-souza', 'daludishop')
      and t.starts_on = '2026-10-01'
  ) then
    raise exception 'Restaram termos em 2026-10 para as organizacoes alvo' using errcode = '23514';
  end if;
end $$;

commit;
```

---

## 4. Plano de Validação e Testes

1. **Testes Unitários de Frontend:**
   - Executar `pnpm test src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`.
2. **Typecheck e Lint:**
   - Executar `npx tsc -b --force`.
   - Executar `pnpm eslint src/components/platform-admin/commercial-terms-form.tsx src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`.
3. **Revisão Adversarial:**
   - Submissão ao Codex para validação final de aprovação.
