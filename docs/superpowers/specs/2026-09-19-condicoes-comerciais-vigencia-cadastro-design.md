# Especificação de Design — Vigência Imediata no Cadastro de Condições Comerciais

**Data:** 2026-09-19  
**Status:** Aprovado para planejamento  
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
2. **Renegociações futuras mantidas:**
   - A regra de renegociação permanece inalterada: contratos posteriores para organizações que já possuem termo comercial continuam valendo a partir do próximo mês (`effectiveStartsOn = nextMonth`), preservando a estabilidade da competência em andamento.
3. **Correção dos dados existentes (Backend / Supabase PostgreSQL):**
   - Criar migration para atualizar os registros de `platform_commercial_terms` das organizações afetadas de `starts_on = '2026-10-01'` para `'2026-09-01'`.
   - Caso `setup_due_month` esteja preenchido como `'2026-10-01'`, atualizá-lo para `'2026-09-01'`.
   - O trigger de imutabilidade `platform_commercial_terms_no_mutation` deve ser temporariamente desabilitado durante a execução da transação de migração e reabilitado em seguida.
   - Gerar evento de auditoria em `platform_audit_events` com categoria `'admin'`, ação `'platform_terms_vigencia_corrigida'` e motivo explicativo para cada linha atualizada.

### 2.2 Requisitos Não-Funcionais

1. **Cirúrgico e sem efeitos colaterais:** Não alterar a lógica de cálculo de faturamento, conciliações ou faixas de receita (`revenue_bps_t1..t4`).
2. **Testabilidade:**
   - Testes unitários do componente `CommercialTermsForm` (`src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`) devem testar e garantir o padrão no mês corrente.
   - Suite de testes do Supabase (`supabase/tests/platform_commercial.sql`) deve refletir a nova migration.

---

## 3. Arquitetura e Detalhamento das Alterações

### 3.1 Frontend: `src/components/platform-admin/commercial-terms-form.tsx`

1. **Valores iniciais de vigência:**
   ```typescript
   // Antes:
   const [startsOn, setStartsOn] = useState(nextMonth);
   useEffect(() => {
     setStartsOn(nextMonth);
     setForm(initialState(current, nextMonth));
     ...
   }, [current, orgId, nextMonth]);

   // Depois:
   const [startsOn, setStartsOn] = useState(currentMonth);
   useEffect(() => {
     setStartsOn(currentMonth);
     setForm(initialState(current, currentMonth));
     ...
   }, [current, orgId, currentMonth]);
   ```
2. **Opções do `<select>` no primeiro contrato:**
   ```tsx
   <select
     aria-label="Início da vigência"
     className="h-9 w-full rounded-md border border-input bg-transparent px-3"
     value={startsOn}
     onChange={(event) => setStartsOn(event.target.value)}
   >
     <option value={currentMonth}>Este mês ({currentMonth})</option>
     <option value={nextMonth}>Próximo mês ({nextMonth})</option>
   </select>
   ```
3. **Texto de ajuda:**
   Atualizar para indicar `"Primeiro contrato inicia neste mês. Padrão: este mês."`.

### 3.2 Banco de Dados: Migration Supabase

Arquivo: `supabase/migrations/20260919130000_platform_terms_vigencia_setembro.sql`

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

---

## 4. Plano de Validação e Testes

1. **Testes Unitários de Frontend:**
   - Executar `pnpm test src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`.
   - Garantir que o caso `salva modalidade e vigência padrão no mês corrente` passe.
   - Garantir que a opção de selecionar explicitamente o próximo mês continue funcionando.
2. **Typecheck e Lint:**
   - Executar `pnpm typecheck` (ou `tsc --noEmit`).
   - Executar `pnpm lint` nos arquivos alterados.
3. **Revisão Adversarial com Codex (`gpt-5.6-sol`, reasoning effort high):**
   - Executar verificação rigorosa antes de qualquer aplicação de código.
