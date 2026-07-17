# Ocultar lucro no card do Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ocultar por padrão a linha "lucro R$ X" do card "Líquido no faturamento" no Dashboard, com um toggle em Configurações (por organização) para reexibi-la.

**Architecture:** Nova coluna booleana `configuracoes.mostrar_lucro_dashboard` (default `false`), seguindo 1:1 o padrão já existente de `reancora_lider_ativa`: par `fetchX`/`upsertX` em `queries.ts`, par `useX`/`useSalvarX` em `useConfiguracoes.ts`, `Switch` em `Configuracoes.tsx`. O `Dashboard.tsx` lê o valor e só monta a string `hint` do `KpiCard` quando estiver ligado.

**Tech Stack:** React + TypeScript, TanStack Query, Supabase (Postgres + RLS), Vitest + Testing Library, shadcn/radix `Switch`.

## Global Constraints

- Migrations: **só** `supabase migration new <nome>` + `supabase db push`; validar com `npm run db:check`. Nunca editar o schema por outro caminho (ADR-0043).
- RLS da tabela `configuracoes` já existe e cobre a nova coluna automaticamente (leitura por qualquer membro da org via `configuracoes: select org`, escrita só admin via `configuracoes: update admin org`/`insert admin org`) — nenhuma migration de RLS nova é necessária.
- `configuracoes` é uma linha por `org_id` (não por usuário) — todo fetch/upsert filtra por `org_id` de `useAuthStore.getState().profile?.org_id`.
- Sem ADR novo: toggle de exibição, não altera cálculo de lucro/margem.
- `pnpm lint` + `pnpm test` devem passar no final; `pnpm build` (`tsc -b`) valida tipos após qualquer mudança em `database.types.ts`.

---

## File Structure

- **`supabase/migrations/<timestamp>_mostrar_lucro_dashboard.sql`** (novo) — coluna `configuracoes.mostrar_lucro_dashboard boolean not null default false`.
- **`src/lib/database.types.ts`** (editar) — adiciona `mostrar_lucro_dashboard` em `Row`/`Insert`/`Update` de `configuracoes`.
- **`src/lib/queries.ts`** (editar) — `fetchMostrarLucroDashboard`/`upsertMostrarLucroDashboard`.
- **`src/hooks/useConfiguracoes.ts`** (editar) — `useMostrarLucroDashboard`/`useSalvarMostrarLucroDashboard`.
- **`src/pages/Configuracoes.tsx`** (editar) — novo `Card` com `Switch`.
- **`src/pages/Dashboard.tsx`** (editar) — gate do `hint` no card "Líquido no faturamento".
- **`tests/pages/Configuracoes.test.tsx`** (editar) — mock dos novos hooks + teste do novo `Switch`.
- **`tests/pages/Dashboard.test.tsx`** (editar) — mock de `useMostrarLucroDashboard` + testes ligado/desligado.
- **Docs** (editar): `obsidian-vault/03-Módulos/Dashboard.md`, `obsidian-vault/03-Módulos/Configurações.md`, `docs/reference/modelo-de-dados.md`, `docs/TASKS.md`.

---

### Task 1: Migration + tipos do banco

**Files:**
- Create: `supabase/migrations/<timestamp>_mostrar_lucro_dashboard.sql` (timestamp gerado pelo comando abaixo)
- Modify: `src/lib/database.types.ts:88-139` (bloco `configuracoes`)

**Interfaces:**
- Produces: coluna `configuracoes.mostrar_lucro_dashboard: boolean` disponível em `Database['public']['Tables']['configuracoes']['Row'/'Insert'/'Update']` — Task 2 depende deste tipo existir para o `supabase.from('configuracoes').select('mostrar_lucro_dashboard')` tipar corretamente.

- [ ] **Step 1: Criar o arquivo de migration**

Run: `supabase migration new mostrar_lucro_dashboard`
Expected: cria `supabase/migrations/<timestamp>_mostrar_lucro_dashboard.sql` vazio. Anote o nome exato gerado (timestamp = data/hora atual).

- [ ] **Step 2: Escrever o conteúdo da migration**

```sql
-- Toggle por org: mostra (ou não) a linha "lucro R$ X" no card "Líquido no faturamento" do
-- Dashboard. Oculta por padrão — o lucro/margem continuam calculados normalmente em
-- cockpit.ts/resumo-vendas.ts, isto só afeta a exibição desse card.
alter table configuracoes
  add column if not exists mostrar_lucro_dashboard boolean not null default false;
```

- [ ] **Step 3: Aplicar a migration**

Run: `supabase db push`
Expected: saída confirmando a migration aplicada, sem erro.

- [ ] **Step 4: Validar alinhamento local/remoto**

Run: `npm run db:check`
Expected: `✓ Migrations alinhadas (local = remoto).`

- [ ] **Step 5: Atualizar `database.types.ts`**

Em `src/lib/database.types.ts`, dentro do bloco `configuracoes` (linhas 88-139), adicionar
`mostrar_lucro_dashboard` em ordem alfabética (entre `desconto_pct` e `mp_access_token_secret_id`)
nas três seções:

```ts
        Row: {
          ai_model_imagem: string | null
          ai_model_texto: string | null
          aliquota_importado_pct: number
          aliquota_nacional_pct: number
          atualizado_em: string
          criado_em: string
          desconto_concorrencia_pct: number
          desconto_pct: number
          mostrar_lucro_dashboard: boolean
          mp_access_token_secret_id: string | null
          org_id: string
          reancora_lider_ativa: boolean
          telegram_ativo: boolean
          telegram_bot_token: string | null
          telegram_chat_id: string | null
          user_id: string
        }
        Insert: {
          ai_model_imagem?: string | null
          ai_model_texto?: string | null
          aliquota_importado_pct?: number
          aliquota_nacional_pct?: number
          atualizado_em?: string
          criado_em?: string
          desconto_concorrencia_pct?: number
          desconto_pct?: number
          mostrar_lucro_dashboard?: boolean
          mp_access_token_secret_id?: string | null
          org_id: string
          reancora_lider_ativa?: boolean
          telegram_ativo?: boolean
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          user_id: string
        }
        Update: {
          ai_model_imagem?: string | null
          ai_model_texto?: string | null
          aliquota_importado_pct?: number
          aliquota_nacional_pct?: number
          atualizado_em?: string
          criado_em?: string
          desconto_concorrencia_pct?: number
          desconto_pct?: number
          mostrar_lucro_dashboard?: boolean
          mp_access_token_secret_id?: string | null
          org_id?: string
          reancora_lider_ativa?: boolean
          telegram_ativo?: boolean
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          user_id?: string
        }
```

- [ ] **Step 6: Confirmar que os tipos compilam**

Run: `pnpm build`
Expected: build passa sem erro de tipo.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations src/lib/database.types.ts
git commit -m "feat: add configuracoes.mostrar_lucro_dashboard column"
```

---

### Task 2: `fetchMostrarLucroDashboard`/`upsertMostrarLucroDashboard` em `queries.ts`

Nenhum teste dedicado: nenhuma outra função `fetchX`/`upsertX` de `configuracoes` tem teste
próprio no repo (ex.: `fetchReancoraLiderAtiva`/`upsertReancoraLiderAtiva` não têm — são
passthroughs finos do Supabase, cobertos indiretamente pelos testes de UI da Task 4/5, que
mockam `useConfiguracoes` inteiro). Segue o mesmo padrão aqui — o `pnpm build` do Step 2 é a
única verificação (compila = assinatura e nome de coluna corretos).

**Files:**
- Modify: `src/lib/queries.ts:464` (logo após `upsertReancoraLiderAtiva`, antes de `fetchModeloTexto`)

**Interfaces:**
- Consumes: coluna `mostrar_lucro_dashboard` (Task 1), `supabase`, `useAuthStore` (já importados no topo do arquivo).
- Produces: `fetchMostrarLucroDashboard(): Promise<boolean>`, `upsertMostrarLucroDashboard(ativo: boolean): Promise<void>` — Task 3 importa os dois por esse nome exato.

- [ ] **Step 1: Adicionar as funções**

Inserir logo após `upsertReancoraLiderAtiva` (linha 464 atual) em `src/lib/queries.ts`:

```ts
export async function fetchMostrarLucroDashboard(): Promise<boolean> {
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) return false;
  const { data } = await supabase.from('configuracoes')
    .select('mostrar_lucro_dashboard').eq('org_id', orgId).maybeSingle();
  return data?.mostrar_lucro_dashboard ?? false;
}

export async function upsertMostrarLucroDashboard(ativo: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, mostrar_lucro_dashboard: ativo, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}
```

- [ ] **Step 2: Confirmar que compila**

Run: `pnpm build`
Expected: passa sem erro.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat: add mostrar-lucro-dashboard queries"
```

---

### Task 3: `useMostrarLucroDashboard`/`useSalvarMostrarLucroDashboard` em `useConfiguracoes.ts`

Mesma justificativa da Task 2 para ausência de teste dedicado: nenhum par `useX`/`useSalvarX`
de `useConfiguracoes.ts` tem teste próprio — são finos wrappers de `useQuery`/`useMutation`,
exercitados pelos testes de página (Task 4/5) que mockam o módulo inteiro.

**Files:**
- Modify: `src/hooks/useConfiguracoes.ts:6` (import) e após linha 53 (logo após `useSalvarReancoraLiderAtiva`, antes de `useTelegramConfig`)

**Interfaces:**
- Consumes: `fetchMostrarLucroDashboard`, `upsertMostrarLucroDashboard` (Task 2).
- Produces: `useMostrarLucroDashboard(): { data: boolean | undefined, ... }`,
  `useSalvarMostrarLucroDashboard(): { mutate: (ativo: boolean) => void, isPending, isSuccess, ... }`
  — Task 4 e Task 5 consomem por esses nomes exatos.

- [ ] **Step 1: Atualizar o import**

Em `src/hooks/useConfiguracoes.ts:6`, mudar:

```ts
  fetchReancoraLiderAtiva, upsertReancoraLiderAtiva,
```
para:
```ts
  fetchReancoraLiderAtiva, upsertReancoraLiderAtiva,
  fetchMostrarLucroDashboard, upsertMostrarLucroDashboard,
```

- [ ] **Step 2: Adicionar os hooks**

Inserir logo após o bloco `useSalvarReancoraLiderAtiva` (linha 53 atual), antes de `useTelegramConfig`:

```ts
export function useMostrarLucroDashboard() {
  return useQuery({ queryKey: ['configuracoes', 'mostrar_lucro_dashboard'], queryFn: fetchMostrarLucroDashboard });
}
export function useSalvarMostrarLucroDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ativo: boolean) => upsertMostrarLucroDashboard(ativo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'mostrar_lucro_dashboard'] }),
  });
}
```

- [ ] **Step 3: Confirmar que compila**

Run: `pnpm build`
Expected: passa sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useConfiguracoes.ts
git commit -m "feat: add useMostrarLucroDashboard hooks"
```

---

### Task 4: Switch em Configurações

**Files:**
- Modify: `src/pages/Configuracoes.tsx:14` (import), `:41` (hooks), após `:183` (novo `Card`)
- Test: `tests/pages/Configuracoes.test.tsx`

**Interfaces:**
- Consumes: `useMostrarLucroDashboard`, `useSalvarMostrarLucroDashboard` (Task 3).

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/pages/Configuracoes.test.tsx`, atualizar o mock de `@/hooks/useConfiguracoes` (linhas 14-27) adicionando as duas novas entradas, e adicionar um novo `describe`:

```ts
const salvarReancoraLiderAtiva = vi.fn();
const salvarMostrarLucroDashboard = vi.fn();

vi.mock('@/hooks/useConfiguracoes', () => ({
  useDescontoPct: () => ({ data: 15 }),
  useSalvarDescontoPct: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useDescontoConcorrenciaPct: () => ({ data: 5 }),
  useSalvarDescontoConcorrenciaPct: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useAliquotas: () => ({ data: { nacional: 8, importado: 16 } }),
  useSalvarAliquotas: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useReancoraLiderAtiva: () => ({ data: true }),
  useSalvarReancoraLiderAtiva: () => ({ mutate: salvarReancoraLiderAtiva, isPending: false, isSuccess: false }),
  useMostrarLucroDashboard: () => ({ data: false }),
  useSalvarMostrarLucroDashboard: () => ({ mutate: salvarMostrarLucroDashboard, isPending: false, isSuccess: false }),
  useModeloTexto: () => ({ data: 'openai/gpt-4o-mini' }),
  useSalvarModeloTexto: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useModeloImagem: () => ({ data: 'google/gemini-2.5-flash-image' }),
  useSalvarModeloImagem: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
}));
```

Adicionar, no final do arquivo, após o `describe` existente:

```ts
describe('Configurações — mostrar lucro no Dashboard', () => {
  it('reflete o valor atual (desligado) e dispara a mutation ao alternar', () => {
    renderPage();

    const toggle = screen.getByRole('switch', { name: /mostrar lucro no card do dashboard/i });
    expect(toggle).toHaveAttribute('data-state', 'unchecked');

    fireEvent.click(toggle);
    expect(salvarMostrarLucroDashboard).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm test tests/pages/Configuracoes.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "switch" and name /mostrar lucro no card do dashboard/i` (o `Card`/`Switch` ainda não existe em `Configuracoes.tsx`).

- [ ] **Step 3: Implementar o Card**

Em `src/pages/Configuracoes.tsx:14`, adicionar ao import de `@/hooks/useConfiguracoes`:

```tsx
  useReancoraLiderAtiva, useSalvarReancoraLiderAtiva,
  useMostrarLucroDashboard, useSalvarMostrarLucroDashboard,
```

Logo após a linha `const salvarReancoraLiderAtiva = useSalvarReancoraLiderAtiva();` (linha 41 atual), adicionar:

```tsx
  const { data: mostrarLucroDashboard } = useMostrarLucroDashboard();
  const salvarMostrarLucroDashboard = useSalvarMostrarLucroDashboard();
```

Logo após o `Card` de "Ancorar preço no piso dos MercadoLíderes" (fecha em `</Card>` na linha 183 atual), adicionar um novo `Card`:

```tsx
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Mostrar lucro no card do Dashboard</h2>
            <Switch
              checked={mostrarLucroDashboard ?? false}
              onCheckedChange={(v) => salvarMostrarLucroDashboard.mutate(v)}
              aria-label="Mostrar lucro no card do Dashboard"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Quando desligado (padrão), o card "Líquido no faturamento" do Dashboard não mostra o
            valor de lucro do período.
          </p>
          {salvarMostrarLucroDashboard.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
          {salvarMostrarLucroDashboard.isSuccess && !salvarMostrarLucroDashboard.isPending && (
            <span className="text-xs text-success">✓ Salvo</span>
          )}
        </Card>
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm test tests/pages/Configuracoes.test.tsx`
Expected: PASS (2 testes: re-âncora + mostrar lucro).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Configuracoes.tsx tests/pages/Configuracoes.test.tsx
git commit -m "feat: add toggle to show/hide lucro on Dashboard card"
```

---

### Task 5: Ocultar o `hint` de lucro no Dashboard por padrão

**Files:**
- Modify: `src/pages/Dashboard.tsx:32` (import), `:103` (hook), `:287` (`hint`)
- Test: `tests/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `useMostrarLucroDashboard` (Task 3).

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/pages/Dashboard.test.tsx`, trocar o mock estático de `@/hooks/useConfiguracoes`
(linhas 75-77) por uma versão mockável, e reescrever o `describe` final para cobrir os dois
estados:

```ts
const useMostrarLucroDashboardMock = vi.fn();

vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 10, importado: 20 } }),
  useMostrarLucroDashboard: () => useMostrarLucroDashboardMock(),
}));
```

Substituir o `describe('Dashboard', ...)` existente por:

```ts
describe('Dashboard', () => {
  it('prioriza líquido no card antes usado para lucro líquido', () => {
    useMostrarLucroDashboardMock.mockReturnValue({ data: false });
    render(<Dashboard />, { wrapper: MemoryRouter });

    expect(screen.getByText('Líquido no faturamento')).toBeInTheDocument();
    expect(screen.getByText('R$ 52,50')).toBeInTheDocument();
    expect(screen.queryByText('Lucro líquido')).not.toBeInTheDocument();
  });

  it('oculta a linha de lucro por padrão (toggle desligado)', () => {
    useMostrarLucroDashboardMock.mockReturnValue({ data: false });
    render(<Dashboard />, { wrapper: MemoryRouter });

    expect(screen.queryByText('lucro R$ 111,00')).not.toBeInTheDocument();
  });

  it('mostra a linha de lucro quando o toggle está ligado', () => {
    useMostrarLucroDashboardMock.mockReturnValue({ data: true });
    render(<Dashboard />, { wrapper: MemoryRouter });

    expect(screen.getByText('lucro R$ 111,00')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm test tests/pages/Dashboard.test.tsx`
Expected: FAIL no teste "oculta a linha de lucro por padrão" — `lucro R$ 111,00` está presente
mesmo com `data: false` (código atual sempre mostra o `hint`).

- [ ] **Step 3: Implementar o gate**

Em `src/pages/Dashboard.tsx:32`, mudar:

```ts
import { useAliquotas } from '@/hooks/useConfiguracoes';
```
para:
```ts
import { useAliquotas, useMostrarLucroDashboard } from '@/hooks/useConfiguracoes';
```

Logo após `const { data: aliquotas } = useAliquotas();` (linha 103 atual), adicionar:

```ts
  const { data: mostrarLucro } = useMostrarLucroDashboard();
```

Em `src/pages/Dashboard.tsx:287`, trocar:

```tsx
          hint={r.margem != null ? `lucro ${fmtBRL(r.lucro)}` : undefined}
```
por:
```tsx
          hint={mostrarLucro && r.margem != null ? `lucro ${fmtBRL(r.lucro)}` : undefined}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm test tests/pages/Dashboard.test.tsx`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard.tsx tests/pages/Dashboard.test.tsx
git commit -m "fix: hide lucro hint on Dashboard KPI card by default"
```

---

### Task 6: Suíte completa + documentação

**Files:**
- Modify: `obsidian-vault/03-Módulos/Dashboard.md`, `obsidian-vault/03-Módulos/Configurações.md`, `docs/reference/modelo-de-dados.md`, `docs/TASKS.md`

- [ ] **Step 1: Rodar a suíte inteira e o lint**

Run: `pnpm lint && pnpm test`
Expected: ambos passam sem erro/warning novo.

- [ ] **Step 2: Atualizar `obsidian-vault/03-Módulos/Dashboard.md`**

Na seção "## KPIs" (linha 12-13 atual), adicionar ao final do bullet existente:

```md
- **KPIs** (`src/lib/dashboard-kpis.ts` → `calcularKpisDashboard`): publicados, ativos, com
  problema (`moderado`/`inativo`/`pausado`), erros, a revisar. O card "Líquido no faturamento"
  só mostra o hint de lucro (`lucro R$ X`) quando `configuracoes.mostrar_lucro_dashboard`
  estiver ligado (padrão: oculto) — toggle em [[Configurações]].
```

- [ ] **Step 3: Atualizar `obsidian-vault/03-Módulos/Configurações.md`**

Na seção "## O que configura", adicionar um novo bullet após o de "Re-âncora no maior vendedor
MercadoLíder" (linha 33-36 atual):

```md
- **Mostrar lucro no Dashboard** — `mostrar_lucro_dashboard` (default false, por org,
  `useMostrarLucroDashboard`, `useSalvarMostrarLucroDashboard`). Liga a linha "lucro R$ X" no
  card "Líquido no faturamento" do Dashboard (oculta por padrão).
```

Na seção "## Tabela `configuracoes`" (linha 38-44 atual), adicionar `mostrar_lucro_dashboard` à
lista de colunas.

- [ ] **Step 4: Atualizar `docs/reference/modelo-de-dados.md`**

Na seção `### configuracoes` (linha 277-292 atual), após o bullet de `reancora_lider_ativa`
(linha 287-288), adicionar:

```md
`mostrar_lucro_dashboard` (default false, migration `<timestamp>_mostrar_lucro_dashboard.sql`)
— liga a exibição do lucro (`lucro R$ X`) no card "Líquido no faturamento" do Dashboard —,
```

(substituir `<timestamp>` pelo nome real gerado na Task 1, Step 1).

- [ ] **Step 5: Adicionar entrada em `docs/TASKS.md`**

No final da seção mais recente relevante (mesmo padrão das entradas `- [x] **Título** (data) —
descrição.`), adicionar:

```md
- [x] **Ocultar lucro no card do Dashboard por padrão** (2026-07-17) — o card "Líquido no
  faturamento" mostrava sempre o lucro do período (`hint` "lucro R$ X"); Diego pediu para ficar
  oculto por padrão. Nova coluna `configuracoes.mostrar_lucro_dashboard` (default false, por
  org) segue 1:1 o padrão de `reancora_lider_ativa`; toggle em Configurações
  (`useMostrarLucroDashboard`/`useSalvarMostrarLucroDashboard`). `Dashboard.tsx` só monta o
  `hint` do `KpiCard` quando o toggle está ligado. Spec:
  [2026-07-17-ocultar-lucro-dashboard-design.md](superpowers/specs/2026-07-17-ocultar-lucro-dashboard-design.md)
  · Plano: [2026-07-17-ocultar-lucro-dashboard.md](superpowers/plans/2026-07-17-ocultar-lucro-dashboard.md).
  TDD (3 testes novos/ajustados). Só frontend + 1 coluna nova (sem RLS nova).
```

- [ ] **Step 6: Commit**

```bash
git add obsidian-vault/03-Módulos/Dashboard.md obsidian-vault/03-Módulos/Configurações.md docs/reference/modelo-de-dados.md docs/TASKS.md
git commit -m "docs: document mostrar_lucro_dashboard toggle"
```

---

## Self-Review

- **Cobertura do spec:** migration+RLS reaproveitada (Task 1), `queries.ts` (Task 2),
  `useConfiguracoes.ts` (Task 3), `Configuracoes.tsx` (Task 4), `Dashboard.tsx` (Task 5), docs
  (Task 6), validação manual no navegador — fica para o executor confirmar no fim, junto do
  `pnpm lint && pnpm test` da Task 6 (não repetido aqui por já estar coberto).
- **Placeholders:** nenhum `TBD`/"depois" — o único valor a preencher em tempo de execução é o
  timestamp da migration (inerente ao comando `supabase migration new`, não um placeholder de
  plano).
- **Consistência de nomes:** `mostrar_lucro_dashboard` (coluna) →
  `fetchMostrarLucroDashboard`/`upsertMostrarLucroDashboard` (Task 2) →
  `useMostrarLucroDashboard`/`useSalvarMostrarLucroDashboard` (Task 3, 4, 5) — mesmo nome em
  toda a cadeia, conferido contra os arquivos reais do repo antes de escrever o plano.
