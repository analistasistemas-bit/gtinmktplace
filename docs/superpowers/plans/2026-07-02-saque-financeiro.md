# Saque Financeiro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to mark selected released financial orders as `sacado` and undo that mark from `Financeiro > Detalhe do líquido`.

**Architecture:** Persist the withdrawal mark directly on `ml_vendas` with `sacado_em` and `sacado_por`. Because `ml_vendas` is read-only to normal app RLS, writes go through two narrow `security definer` RPCs that only touch those two fields and enforce eligibility. The UI derives display status from a shared pure helper so table filters and export use the same rule.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Supabase/Postgres, TanStack Query, shadcn/Radix UI, Sonner.

## Global Constraints

- No new dependency.
- No `saques` table.
- No saque event history.
- `Registrar saque` only updates selected records whose current status is `liberado`.
- `Desfazer saque` only updates selected records whose current status is `sacado`.
- Selections can be made from `Todos`, `Liberados`, or `Sacados`; invalid selected records are ignored with feedback.
- Use `rtk` prefix for shell commands.
- Keep the implementation scoped to the fewest files that preserve correctness.

---

## File Structure

- Create `supabase/migrations/20260702153000_ml_vendas_saque.sql`
  Adds `sacado_em`, `sacado_por`, and two RPCs: `registrar_saque_ml_vendas(uuid[])` and `desfazer_saque_ml_vendas(uuid[])`.

- Modify `src/lib/database.types.ts`
  Add generated-type equivalents for new columns and RPC signatures.

- Modify `src/lib/faturamento.ts`
  Include `sacado_em`/`sacado_por` in `Venda`, `buscarVendas`, and expose RPC client helpers.

- Modify `src/lib/pedidos-faturamento.ts`
  Carry grouped venda IDs and representative saque state into each `Pedido`.

- Create `src/lib/status-liberacao.ts`
  Pure helper for `a liberar` / `liberado` / `sacado` / no status.

- Create `src/lib/__tests__/status-liberacao.test.ts`
  Unit tests for the derived status.

- Modify `src/pages/DetalheFinanceiro.tsx`
  Add row selection, `Sacados` filter, `Registrar saque`, `Desfazer saque`, and shared status rendering.

- Modify `src/lib/export/adapters.ts`
  Use shared status helper for the `Liberação` export column and include `Sacados` filter label.

---

### Task 1: Database Columns and Narrow RPCs

**Files:**
- Create: `supabase/migrations/20260702153000_ml_vendas_saque.sql`
- Modify: `src/lib/database.types.ts`

**Interfaces:**
- Produces: `ml_vendas.sacado_em: string | null`
- Produces: `ml_vendas.sacado_por: string | null`
- Produces RPC: `registrar_saque_ml_vendas(p_ids uuid[]) returns integer`
- Produces RPC: `desfazer_saque_ml_vendas(p_ids uuid[]) returns integer`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260702153000_ml_vendas_saque.sql`:

```sql
-- Marcação manual de saque no detalhe financeiro.
-- ml_vendas segue read-only via RLS para o app; as escritas ficam restritas às RPCs abaixo.

alter table public.ml_vendas
  add column if not exists sacado_em timestamptz,
  add column if not exists sacado_por uuid references public.profiles(id) on delete set null;

comment on column public.ml_vendas.sacado_em is
  'Quando o recebimento desta venda foi marcado manualmente como sacado no Financeiro.';

comment on column public.ml_vendas.sacado_por is
  'Usuário que marcou o recebimento desta venda como sacado.';

create or replace function public.registrar_saque_ml_vendas(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_membro_operacao() then
    raise exception 'not allowed';
  end if;

  update public.ml_vendas
     set sacado_em = now(),
         sacado_por = auth.uid()
   where id = any(p_ids)
     and money_release_date is not null
     and money_release_date <= now()
     and sacado_em is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.desfazer_saque_ml_vendas(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_membro_operacao() then
    raise exception 'not allowed';
  end if;

  update public.ml_vendas
     set sacado_em = null,
         sacado_por = null
   where id = any(p_ids)
     and sacado_em is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.registrar_saque_ml_vendas(uuid[]) from public;
revoke all on function public.desfazer_saque_ml_vendas(uuid[]) from public;
grant execute on function public.registrar_saque_ml_vendas(uuid[]) to authenticated;
grant execute on function public.desfazer_saque_ml_vendas(uuid[]) to authenticated;
```

- [ ] **Step 2: Update TypeScript database types**

In `src/lib/database.types.ts`, add these fields to `public.Tables.ml_vendas.Row`:

```ts
sacado_em: string | null
sacado_por: string | null
```

Add these fields to `public.Tables.ml_vendas.Insert`:

```ts
sacado_em?: string | null
sacado_por?: string | null
```

Add these fields to `public.Tables.ml_vendas.Update`:

```ts
sacado_em?: string | null
sacado_por?: string | null
```

Add these function signatures under `public.Functions`:

```ts
desfazer_saque_ml_vendas: {
  Args: { p_ids: string[] }
  Returns: number
}
registrar_saque_ml_vendas: {
  Args: { p_ids: string[] }
  Returns: number
}
```

- [ ] **Step 3: Run SQL/type checks**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.app.json --noEmit
```

Expected: no TypeScript errors from `database.types.ts`.

- [ ] **Step 4: Commit**

```bash
rtk git add supabase/migrations/20260702153000_ml_vendas_saque.sql src/lib/database.types.ts
rtk git commit -m "feat(financeiro): persistir marca de saque"
```

---

### Task 2: Shared Status Helper and Data Plumbing

**Files:**
- Create: `src/lib/status-liberacao.ts`
- Create: `src/lib/__tests__/status-liberacao.test.ts`
- Modify: `src/lib/faturamento.ts`
- Modify: `src/lib/pedidos-faturamento.ts`

**Interfaces:**
- Consumes: `ml_vendas.sacado_em`, `ml_vendas.sacado_por`, RPCs from Task 1
- Produces: `statusLiberacao(args, agoraMs?)`
- Produces type: `StatusLiberacao = 'aliberar' | 'liberado' | 'sacado' | 'sem_data'`
- Produces client helpers: `registrarSaque(ids: string[]): Promise<number>` and `desfazerSaque(ids: string[]): Promise<number>`
- Produces `Venda.vendaIds` indirectly through `Pedido.vendaIds`

- [ ] **Step 1: Write the failing status test**

Create `src/lib/__tests__/status-liberacao.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { statusLiberacao, labelStatusLiberacao } from '../status-liberacao';

const agora = Date.parse('2026-07-02T12:00:00Z');

describe('statusLiberacao', () => {
  it('classifica data futura como a liberar', () => {
    expect(statusLiberacao({ money_release_date: '2026-07-03T00:00:00Z', sacado_em: null }, agora)).toBe('aliberar');
  });

  it('classifica data passada sem saque como liberado', () => {
    expect(statusLiberacao({ money_release_date: '2026-07-01T00:00:00Z', sacado_em: null }, agora)).toBe('liberado');
  });

  it('classifica qualquer registro com sacado_em como sacado', () => {
    expect(statusLiberacao({
      money_release_date: '2026-07-01T00:00:00Z',
      sacado_em: '2026-07-02T10:00:00Z',
    }, agora)).toBe('sacado');
  });

  it('classifica sem data e sem saque como sem_data', () => {
    expect(statusLiberacao({ money_release_date: null, sacado_em: null }, agora)).toBe('sem_data');
  });

  it('expõe rótulos da UI', () => {
    expect(labelStatusLiberacao('aliberar')).toBe('a liberar');
    expect(labelStatusLiberacao('liberado')).toBe('liberado');
    expect(labelStatusLiberacao('sacado')).toBe('sacado');
    expect(labelStatusLiberacao('sem_data')).toBe('—');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
rtk pnpm test src/lib/__tests__/status-liberacao.test.ts
```

Expected: FAIL because `src/lib/status-liberacao.ts` does not exist.

- [ ] **Step 3: Implement the status helper**

Create `src/lib/status-liberacao.ts`:

```ts
export type StatusLiberacao = 'aliberar' | 'liberado' | 'sacado' | 'sem_data';

export interface DadosStatusLiberacao {
  money_release_date: string | null;
  sacado_em: string | null;
}

export function statusLiberacao(v: DadosStatusLiberacao, agoraMs: number = Date.now()): StatusLiberacao {
  if (v.sacado_em) return 'sacado';
  if (!v.money_release_date) return 'sem_data';
  return Date.parse(v.money_release_date) <= agoraMs ? 'liberado' : 'aliberar';
}

export function labelStatusLiberacao(status: StatusLiberacao): string {
  switch (status) {
    case 'aliberar': return 'a liberar';
    case 'liberado': return 'liberado';
    case 'sacado': return 'sacado';
    case 'sem_data': return '—';
  }
}
```

- [ ] **Step 4: Add venda fields and RPC client helpers**

In `src/lib/faturamento.ts`, add to `Venda`:

```ts
/** Quando o usuário marcou manualmente este recebimento como sacado. */
sacado_em: string | null;
/** Usuário que marcou o recebimento como sacado. */
sacado_por: string | null;
```

In the `buscarVendas` select string, add `sacado_em, sacado_por` immediately after `money_release_date`:

```ts
.select('id, order_id, pack_id, status, status_detail, date_closed, date_created, comprador_nick, comprador_nome, comprador_id, uf, cidade, total_amount, paid_amount, sale_fee_total, frete_vendedor, liquido, estorno, money_release_date, sacado_em, sacado_por, currency, shipping_id, shipping_status, shipping_substatus, shipping_logistic, tracking_number, is_publiai, tem_devolucao, itens:ml_vendas_itens(id, ml_item_id, variation_id, titulo, codigo, cor, ean, quantity, unit_price, sale_fee, is_publiai)')
```

Add these helpers near `sincronizarFaturamento`:

```ts
export async function registrarSaque(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc('registrar_saque_ml_vendas', { p_ids: ids });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

export async function desfazerSaque(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc('desfazer_saque_ml_vendas', { p_ids: ids });
  if (error) throw new Error(error.message);
  return data ?? 0;
}
```

- [ ] **Step 5: Carry venda IDs and saque state into Pedido**

In `src/lib/pedidos-faturamento.ts`, add to `Pedido`:

```ts
/** IDs das linhas ml_vendas agrupadas neste pedido. */
vendaIds: string[];
/** Quando todas as vendas do pedido foram marcadas como sacadas. null se nenhuma/parte não sacada. */
sacado_em: string | null;
/** Usuário da primeira marcação de saque do grupo, quando o pedido inteiro está sacado. */
sacado_por: string | null;
```

Inside `agruparPorPedido`, before `pedidos.push`, derive:

```ts
const grupoSacado = membros.every((v) => v.sacado_em != null);
const sacado_em = grupoSacado ? membros[0].sacado_em : null;
const sacado_por = grupoSacado ? membros[0].sacado_por : null;
```

Inside the pushed object, add:

```ts
vendaIds: membros.map((v) => v.id),
sacado_em,
sacado_por,
```

- [ ] **Step 6: Update tests that construct Venda**

Any test helper constructing `Venda` must include:

```ts
sacado_em: null,
sacado_por: null,
```

Known files:

- `src/lib/__tests__/resumo-pack-custo.test.ts`
- `src/lib/__tests__/faturamento.test.ts`
- `src/lib/__tests__/cockpit.test.ts`

- [ ] **Step 7: Run tests**

Run:

```bash
rtk pnpm test src/lib/__tests__/status-liberacao.test.ts src/lib/__tests__/resumo-pack-custo.test.ts src/lib/__tests__/faturamento.test.ts src/lib/__tests__/cockpit.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 8: Commit**

```bash
rtk git add src/lib/status-liberacao.ts src/lib/__tests__/status-liberacao.test.ts src/lib/faturamento.ts src/lib/pedidos-faturamento.ts src/lib/__tests__/resumo-pack-custo.test.ts src/lib/__tests__/faturamento.test.ts src/lib/__tests__/cockpit.test.ts
rtk git commit -m "feat(financeiro): derivar status de saque"
```

---

### Task 3: Selection and Saque Actions in Detalhe Financeiro

**Files:**
- Modify: `src/pages/DetalheFinanceiro.tsx`

**Interfaces:**
- Consumes: `statusLiberacao`, `labelStatusLiberacao`
- Consumes: `Pedido.vendaIds`, `Pedido.sacado_em`
- Consumes: `registrarSaque(ids)` and `desfazerSaque(ids)`
- Produces: row selection, `Sacados` filter, `Registrar saque`, `Desfazer saque`

- [ ] **Step 1: Update imports**

In `src/pages/DetalheFinanceiro.tsx`, add imports:

```ts
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { registrarSaque, desfazerSaque } from '@/lib/faturamento';
import { labelStatusLiberacao, statusLiberacao, type StatusLiberacao } from '@/lib/status-liberacao';
```

Merge the `lucide-react` imports into the existing import line instead of adding a duplicate import.

- [ ] **Step 2: Replace CelulaLiberacao with shared status**

Replace `CelulaLiberacao` with:

```tsx
function CelulaLiberacao({ iso, sacadoEm }: { iso: string | null; sacadoEm: string | null }) {
  const status = statusLiberacao({ money_release_date: iso, sacado_em: sacadoEm });
  if (status === 'sem_data') {
    return <TableCell className="align-top whitespace-nowrap text-sm tabular-nums text-muted-foreground">—</TableCell>;
  }
  return (
    <TableCell className="align-top whitespace-nowrap text-sm tabular-nums">
      <span className="block">{fmtData(iso)}</span>
      <span className={cn(
        'text-xs',
        status === 'sacado' ? 'text-primary' : status === 'liberado' ? 'text-success' : 'text-warning',
      )}>
        {labelStatusLiberacao(status)}
      </span>
    </TableCell>
  );
}
```

- [ ] **Step 3: Make LinhaDetalhe controlled by selection**

Change the signature:

```tsx
function LinhaDetalhe({
  p,
  selecionado,
  onSelecionar,
}: {
  p: Pedido;
  selecionado: boolean;
  onSelecionar: (checked: boolean) => void;
}) {
```

Inside the first `TableRow`, add `data-state={selecionado ? 'selected' : undefined}` and change the row click handler so it does not toggle when clicking the checkbox:

```tsx
onClick={(e) => {
  if ((e.target as HTMLElement).closest('[role="checkbox"]')) return;
  setAberto((a) => !a);
}}
```

Replace the first table cell content with checkbox plus expand icon:

```tsx
<TableCell className="w-12 align-top">
  <div className="flex items-center gap-2">
    <Checkbox
      checked={selecionado}
      onCheckedChange={(checked) => onSelecionar(checked === true)}
      aria-label={`Selecionar pedido ${p.chave}`}
    />
    {aberto ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
  </div>
</TableCell>
```

Change the liberação cell call:

```tsx
<CelulaLiberacao iso={p.money_release_date} sacadoEm={p.sacado_em} />
```

- [ ] **Step 4: Add selection state and status-aware filters**

Change filter state type:

```ts
type FiltroLib = 'todos' | 'liberado' | 'aliberar' | 'sacado';
const [filtroLib, setFiltroLib] = useState<FiltroLib>('todos');
const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set());
```

Replace `pedidosFiltrados` filtering with:

```ts
const pedidosFiltrados = useMemo(() => {
  const now = Date.now();
  return pedidos.filter((p) => {
    const status = statusLiberacao({ money_release_date: p.money_release_date, sacado_em: p.sacado_em }, now);
    if (filtroLib === 'liberado') return status === 'liberado';
    if (filtroLib === 'aliberar') return status === 'aliberar';
    if (filtroLib === 'sacado') return status === 'sacado';
    return true;
  });
}, [pedidos, filtroLib]);
```

Add these derived values after `pedidosOrdenados`:

```ts
const idsVisiveis = useMemo(() => new Set(pedidosOrdenados.map((p) => p.chave)), [pedidosOrdenados]);
const selecionadosVisiveis = pedidosOrdenados.filter((p) => selecionados.has(p.chave));
const todosVisiveisSelecionados = pedidosOrdenados.length > 0 && pedidosOrdenados.every((p) => selecionados.has(p.chave));

function setSelecionado(chave: string, checked: boolean) {
  setSelecionados((prev) => {
    const next = new Set(prev);
    if (checked) next.add(chave); else next.delete(chave);
    return next;
  });
}

function selecionarVisiveis(checked: boolean) {
  setSelecionados((prev) => {
    const next = new Set(prev);
    for (const id of idsVisiveis) {
      if (checked) next.add(id); else next.delete(id);
    }
    return next;
  });
}
```

- [ ] **Step 5: Add mutations**

Inside `DetalheFinanceiro`, add:

```ts
const queryClient = useQueryClient();

const mutationRegistrar = useMutation({
  mutationFn: registrarSaque,
  onSuccess: (atualizados, ids) => {
    const ignorados = ids.length - atualizados;
    toast.success(`${atualizados} pedido(s) marcado(s) como sacado(s)`, {
      description: ignorados > 0 ? `${ignorados} registro(s) ignorado(s).` : undefined,
    });
    setSelecionados(new Set());
    queryClient.invalidateQueries({ queryKey: ['vendas'] });
  },
  onError: (e) => toast.error('Falha ao registrar saque', { description: e instanceof Error ? e.message : 'Erro desconhecido' }),
});

const mutationDesfazer = useMutation({
  mutationFn: desfazerSaque,
  onSuccess: (atualizados, ids) => {
    const ignorados = ids.length - atualizados;
    toast.success(`${atualizados} pedido(s) voltou/voltaram para liberado`, {
      description: ignorados > 0 ? `${ignorados} registro(s) ignorado(s).` : undefined,
    });
    setSelecionados(new Set());
    queryClient.invalidateQueries({ queryKey: ['vendas'] });
  },
  onError: (e) => toast.error('Falha ao desfazer saque', { description: e instanceof Error ? e.message : 'Erro desconhecido' }),
});
```

`useVendas` usa query keys que começam com `['vendas']`, então essa invalidação cobre a lista atual.

- [ ] **Step 6: Add action handlers**

Add:

```ts
function vendaIdsPorStatus(statusEsperado: StatusLiberacao): string[] {
  const now = Date.now();
  return selecionadosVisiveis
    .filter((p) => statusLiberacao({ money_release_date: p.money_release_date, sacado_em: p.sacado_em }, now) === statusEsperado)
    .flatMap((p) => p.vendaIds);
}

function onRegistrarSaque() {
  const ids = vendaIdsPorStatus('liberado');
  if (ids.length === 0) {
    toast.error('Selecione pedido(s) liberado(s).');
    return;
  }
  mutationRegistrar.mutate(ids);
}

function onDesfazerSaque() {
  const ids = vendaIdsPorStatus('sacado');
  if (ids.length === 0) {
    toast.error('Selecione pedido(s) sacado(s).');
    return;
  }
  mutationDesfazer.mutate(ids);
}
```

- [ ] **Step 7: Update filter/action toolbar**

Replace the filter buttons block with:

```tsx
<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
  <div className="flex gap-1">
    {([
      ['todos', 'Todos'],
      ['liberado', 'Liberados'],
      ['aliberar', 'A liberar'],
      ['sacado', 'Sacados'],
    ] as const).map(([k, lbl]) => (
      <Button key={k} size="sm" variant={filtroLib === k ? 'default' : 'outline'}
        className="h-7 px-2.5 text-xs" onClick={() => setFiltroLib(k)}>{lbl}</Button>
    ))}
  </div>
  <div className="flex items-center gap-2">
    <span className="text-xs text-muted-foreground">{selecionadosVisiveis.length} selecionado(s)</span>
    <Button size="sm" variant="outline" onClick={onRegistrarSaque}
      disabled={selecionadosVisiveis.length === 0 || mutationRegistrar.isPending || mutationDesfazer.isPending}>
      <CheckCircle2 className="mr-1.5 h-4 w-4" />Registrar saque
    </Button>
    <Button size="sm" variant="outline" onClick={onDesfazerSaque}
      disabled={selecionadosVisiveis.length === 0 || mutationRegistrar.isPending || mutationDesfazer.isPending}>
      <RotateCcw className="mr-1.5 h-4 w-4" />Desfazer saque
    </Button>
  </div>
</div>
```

- [ ] **Step 8: Add select-all checkbox and pass selection props**

In the table header, replace the first head cell with:

```tsx
<TableHead className="w-12">
  <Checkbox
    checked={todosVisiveisSelecionados}
    onCheckedChange={(checked) => selecionarVisiveis(checked === true)}
    aria-label="Selecionar pedidos visíveis"
  />
</TableHead>
```

Change the row render:

```tsx
pedidosOrdenados.map((p) => (
  <LinhaDetalhe
    key={p.chave}
    p={p}
    selecionado={selecionados.has(p.chave)}
    onSelecionar={(checked) => setSelecionado(p.chave, checked)}
  />
))
```

- [ ] **Step 9: Run checks**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.app.json --noEmit
rtk pnpm test src/lib/__tests__/status-liberacao.test.ts
```

Expected: TypeScript passes and status tests pass.

- [ ] **Step 10: Commit**

```bash
rtk git add src/pages/DetalheFinanceiro.tsx
rtk git commit -m "feat(financeiro): marcar pedidos sacados"
```

---

### Task 4: Export, Copy, and Final Verification

**Files:**
- Modify: `src/lib/export/adapters.ts`
- Modify: `src/pages/DetalheFinanceiro.tsx`

**Interfaces:**
- Consumes: `statusLiberacao`, `labelStatusLiberacao`
- Produces: export matching the table status

- [ ] **Step 1: Update export imports**

In `src/lib/export/adapters.ts`, add:

```ts
import { labelStatusLiberacao, statusLiberacao } from '@/lib/status-liberacao';
```

- [ ] **Step 2: Add Sacados filter label**

Change:

```ts
const FILTRO_LIB_LABEL: Record<string, string> = {
  todos: 'Todos', liberado: 'Liberado', aliberar: 'A liberar',
};
```

to:

```ts
const FILTRO_LIB_LABEL: Record<string, string> = {
  todos: 'Todos', liberado: 'Liberado', aliberar: 'A liberar', sacado: 'Sacados',
};
```

- [ ] **Step 3: Use shared status in export**

Replace the `liberacao` cell in `buildFinanceiroDetalheReport`:

```ts
liberacao: p.money_release_date
  ? `${fmtData(p.money_release_date)} · ${new Date(p.money_release_date).getTime() <= Date.now() ? 'liberado' : 'a liberar'}`
  : '—',
```

with:

```ts
liberacao: (() => {
  const status = statusLiberacao({ money_release_date: p.money_release_date, sacado_em: p.sacado_em });
  if (status === 'sem_data') return '—';
  return p.money_release_date
    ? `${fmtData(p.money_release_date)} · ${labelStatusLiberacao(status)}`
    : labelStatusLiberacao(status);
})(),
```

- [ ] **Step 4: Update explanatory copy**

In `src/pages/DetalheFinanceiro.tsx`, update the paragraph near the bottom so the liberação sentence includes sacado:

```tsx
"Liberação" é a data em que o Mercado Livre libera aquele recebimento para saque
("a liberar" = ainda retido; "liberado" = já no saldo; "sacado" = marcado manualmente
como já sacado pelo usuário).
```

- [ ] **Step 5: Run focused checks**

Run:

```bash
rtk pnpm exec tsc -p tsconfig.app.json --noEmit
rtk pnpm test src/lib/__tests__/status-liberacao.test.ts
```

Expected: both commands pass.

- [ ] **Step 6: Run full verification**

Run:

```bash
rtk pnpm test
rtk pnpm run build
```

Expected: Vitest suite passes and Vite build completes.

- [ ] **Step 7: Commit**

```bash
rtk git add src/lib/export/adapters.ts src/pages/DetalheFinanceiro.tsx
rtk git commit -m "feat(financeiro): exportar status sacado"
```

---

## Manual Smoke Test

- Open `Financeiro > Detalhe do líquido`.
- Filter `Liberados`.
- Select one visible liberated pedido.
- Click `Registrar saque`.
- Confirm the row moves to `Sacados` and no longer appears in `Liberados`.
- Filter `Todos`.
- Select a mix of `a liberar`, `liberado`, and `sacado`.
- Click `Registrar saque`.
- Confirm only `liberado` records change and the toast reports ignored records.
- Select a `sacado` record.
- Click `Desfazer saque`.
- Confirm it returns to `Liberados`.
- Export with `Sacados` filter and confirm `Liberação` contains `sacado`.
