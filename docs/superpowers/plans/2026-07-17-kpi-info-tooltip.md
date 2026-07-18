# Ícone de informação nos KPIs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every KPI card and multi-metric panel in Dashboard, Publicados, Financeiro, Faturamento (Vendas + Geografia), and the two drill-down "detalhe" pages gets a clickable "i" icon that opens a popover explaining what the number means, backed by a central description dictionary.

**Architecture:** New `Popover` primitive (Radix, mirrors the existing `Tooltip` wrapper) + a `KpiInfoButton` subcomponent that resolves a description from a central `kpi-descriptions.ts` dictionary and renders nothing if there's no entry. `KpiCard` is extended with `size="compact"` (to absorb the 4 duplicated local `Kpi` components without a visual regression), `tom` (icon/label color), and `infoKey` (dictionary lookup override, only needed for 3 labels whose calculation genuinely differs between screens). `HeroVenda` and two standalone hero cards reuse `KpiInfoButton` directly since they don't go through `KpiCard`.

**Tech Stack:** React 18 + TypeScript, Tailwind v4, Radix UI (`radix-ui` umbrella package, already installed), lucide-react, vitest.

**Read first:** the approved design spec at `docs/superpowers/specs/2026-07-17-kpi-info-tooltip-design.md` — it has the full scope rationale, the pipeline-divergence investigation, and the list of what's explicitly out of scope. This plan implements that spec; if anything here seems to contradict it, the spec is the source of truth for *what*, this plan is the source of truth for *how*.

---

## Why the test strategy is lighter than usual

This codebase has **zero** React Testing Library component-render tests today (`@testing-library/react` is installed but unused — confirmed via repo-wide search). Existing tests are all pure-function unit tests (e.g. `src/pages/__tests__/Revisao.test.tsx`). This plan follows that convention: the only new automated test is a pure-function test for the description dictionary (`getKpiDescription`) and its coverage guard. `KpiInfoButton`'s click/open/close behavior is delegated entirely to Radix Popover (already trusted elsewhere in the app via `Tooltip`) — it is not re-tested. Visual/interaction correctness (popover opens, closes on outside click, doesn't trigger navigation inside links) is verified manually via browser-use in the final task, per the spec's Validação section.

---

## File Structure

**Create:**
- `src/components/ui/popover.tsx` — Radix Popover wrapper (Root/Trigger/Content), same pattern as `src/components/ui/tooltip.tsx`.
- `src/lib/kpi-descriptions.ts` — `KPI_DESCRIPTIONS` dictionary + `getKpiDescription(key)` helper.
- `src/lib/__tests__/kpi-descriptions.test.ts` — coverage guard + spot checks.

**Modify:**
- `src/components/ui/kpi-card.tsx` — add `size`/`tom`/`infoKey` props, export new `KpiInfoButton`.
- `src/components/dashboard-publicados.tsx` — migrate local `Kpi` → `KpiCard size="compact"`; add `KpiInfoButton` to 3 panels; fix stopPropagation on the `<Link>`-wrapped "Faturamento" card.
- `src/pages/Financeiro.tsx` — migrate local `Kpi` → `KpiCard size="compact"`; add `KpiInfoButton` to the hero card.
- `src/components/faturamento/aba-vendas.tsx` — migrate local `Kpi` → `KpiCard size="compact"`.
- `src/components/faturamento/aba-geografia.tsx` — migrate local `Kpi` → `KpiCard size="compact"`.
- `src/pages/Dashboard.tsx` — add `KpiInfoButton` to `HeroVenda`; pass explicit `infoKey` to the 2 divergent `KpiCard` usages ("Pedidos", "Ticket médio").
- `src/pages/DetalheFinanceiro.tsx` — add `KpiInfoButton` to the "Resumo" card.
- `src/pages/DetalheVendas.tsx` — add `KpiInfoButton` to the "Resumo" card.
- `docs/TASKS.md` — add a note about the pipeline-divergence finding (out of scope for this branch, needs its own future fix).

---

## Task 1: `Popover` primitive

**Files:**
- Create: `src/components/ui/popover.tsx`

- [ ] **Step 1: Write the component**

```tsx
import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "start",
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      >
        {children}
        <PopoverPrimitive.Arrow className="fill-popover" width={12} height={6} />
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
```

`bg-popover`/`text-popover-foreground` are already defined in `src/index.css` (light and dark) — confirmed, just currently unused. No new CSS needed.

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit -p .` (or `pnpm lint` if that's faster in this repo)
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/popover.tsx
git commit -m "feat: add Popover UI primitive (Radix wrapper)"
```

---

## Task 2: Description dictionary + coverage guard test

**Files:**
- Create: `src/lib/kpi-descriptions.ts`
- Test: `src/lib/__tests__/kpi-descriptions.test.ts`

This is written test-first: the test lists every label/`infoKey` that will be used across the app once Tasks 3–9 are done, so the dictionary has to satisfy all of them before this task is "done." That list is the actual scope contract — if a later task introduces a card whose label isn't in `ALL_EXPECTED_KEYS` below, the coverage guard won't catch it (it can only check what it's told to expect), so **any new card added in Tasks 4–9 must also get a line added to `ALL_EXPECTED_KEYS` in this test** as part of that task.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/kpi-descriptions.test.ts
import { describe, expect, it } from 'vitest';
import { getKpiDescription, KPI_DESCRIPTIONS } from '../kpi-descriptions';

// Every label/infoKey that renders a KpiInfoButton across the app once Tasks 3-9 land.
// Screen tag in comments matches the spec's screen names.
const ALL_EXPECTED_KEYS = [
  // Dashboard
  'Faturamento bruto',
  'Líquido das vendas',
  'Líquido no faturamento',
  'Markup no período',
  'Compradores',
  'A receber',
  'Pedidos::Dashboard',
  'Ticket médio::Dashboard',
  // Publicados
  'Faturamento::Publicados',
  'Unidades vendidas',
  'Pedidos::Publicados',
  'Ticket médio::Publicados',
  'Lucro no período',
  'Saúde dos anúncios',
  'Encalhados (sem venda no período)',
  'Top produtos (faturamento)',
  // Financeiro
  'Líquido das vendas (você recebe)',
  'Taxas e frete (ML)',
  'Estornos',
  'Ticket médio líquido',
  'Já liberado',
  'A liberar',
  'Vendas no período',
  'Lucro líquido no período',
  // Faturamento / aba Vendas
  'Faturamento::Faturamento/Vendas',
  'Líquido',
  'Pedidos::Faturamento/Vendas',
  'Unidades',
  'Ticket médio::Faturamento/Vendas',
  'Itens / pedido',
  'Markup',
  // Faturamento / aba Geografia
  'Estados atingidos',
  'Top estado',
  'Cidades',
  'Sem localização',
  // Páginas de detalhe (drill-down)
  'Líquido total (você recebe)',
  'Faturamento total',
];

describe('kpi-descriptions', () => {
  it('has a non-empty description for every KPI key used in the app', () => {
    const faltando = ALL_EXPECTED_KEYS.filter((k) => !getKpiDescription(k));
    expect(faltando).toEqual([]);
  });

  it('every dictionary entry is non-empty text', () => {
    for (const [key, texto] of Object.entries(KPI_DESCRIPTIONS)) {
      expect(texto.trim().length, `descrição vazia para "${key}"`).toBeGreaterThan(0);
    }
  });

  it('returns undefined for an unknown key (silent, no throw)', () => {
    expect(getKpiDescription('KPI que não existe')).toBeUndefined();
  });

  it('resolves the exact markup formula text for the non-divergent "Markup no período"', () => {
    expect(getKpiDescription('Markup no período')).toMatch(/custo/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/__tests__/kpi-descriptions.test.ts`
Expected: FAIL — `Cannot find module '../kpi-descriptions'`

- [ ] **Step 3: Write the dictionary**

Every description below is written from the real formula/source read directly in the code (see the design spec's "Achado colateral" section for the pipeline-divergence details behind the 3 composite keys). Do not paraphrase from the label name alone.

```ts
// src/lib/kpi-descriptions.ts

/**
 * Texto explicativo por KPI, mostrado no popover do ícone "i" ao lado do card.
 *
 * Chave = o `label` exato do card na maioria dos casos. Só 3 KPIs têm chave composta
 * `"<label>::<tela>"`, porque o mesmo label é calculado por dois pipelines diferentes
 * em telas diferentes (ver docs/superpowers/specs/2026-07-17-kpi-info-tooltip-design.md,
 * seção "Achado colateral"): "Pedidos", "Ticket médio" e "Faturamento".
 */
export const KPI_DESCRIPTIONS: Record<string, string> = {
  // ── Dashboard ──────────────────────────────────────────────────────────
  'Faturamento bruto':
    'Soma do valor total das vendas aprovadas no período (inclui vendas reembolsadas), antes de descontar comissão, frete e imposto.',
  'Líquido das vendas':
    'O que sobra das vendas aprovadas no período depois de descontar a comissão do Mercado Livre e o frete pago pelo vendedor — antes do imposto.',
  'Líquido no faturamento':
    'Valor líquido recebido pelos pedidos aprovados no período, contado por pedido (carrinho), não por linha de venda — mesma base do menu Faturamento.',
  'Markup no período':
    '(Líquido recebido − imposto − custo) ÷ custo, somado sobre as vendas do período que têm custo cadastrado. Vendas sem custo não entram na conta.',
  Compradores:
    'Número de compradores únicos com pelo menos 1 pedido aprovado no período.',
  'A receber':
    'Valor de vendas já aprovadas que ainda não caiu no seu saldo — aguardando a data de liberação do Mercado Pago.',
  'Pedidos::Dashboard':
    'Número de pedidos aprovados no período, contando cada carrinho (pack) como 1 pedido — mesma base do menu Faturamento.',
  'Ticket médio::Dashboard':
    'Valor bruto do pedido no checkout (não da linha de venda), somado e dividido pelo número de pedidos — mesma base do menu Faturamento.',

  // ── Publicados ─────────────────────────────────────────────────────────
  'Faturamento::Publicados':
    'Soma do valor das vendas aprovadas no período, contada por linha de venda faturável. Pode diferir do "Faturamento" do menu Faturamento em pedidos com um item cancelado e outro pago no mesmo carrinho.',
  'Unidades vendidas':
    'Total de unidades vendidas em vendas aprovadas no período.',
  'Pedidos::Publicados':
    'Número de carrinhos (packs) com pelo menos 1 linha de venda aprovada no período. Pode diferir do "Pedidos" do menu Faturamento em carrinhos com status misto.',
  'Ticket médio::Publicados':
    'Faturamento do período dividido pelo número de pedidos desta tela. Pode diferir do "Ticket médio" do menu Faturamento pelo mesmo motivo do KPI "Pedidos".',
  'Lucro no período':
    'Líquido menos custo dos produtos vendidos, somado sobre as vendas do período com custo cadastrado.',
  'Saúde dos anúncios':
    'Quantos dos seus anúncios publicados estão ativos, quantos têm algum problema (moderação, estoque zerado etc.) e quantas variações estão publicadas ao todo.',
  'Encalhados (sem venda no período)':
    'Anúncios ativos que não tiveram nenhuma venda no período selecionado. Clique no card para filtrar a lista só por eles.',
  'Top produtos (faturamento)':
    'Os produtos que mais faturaram no período, pelo valor das vendas aprovadas.',

  // ── Financeiro ─────────────────────────────────────────────────────────
  'Líquido das vendas (você recebe)':
    'O que sobra das vendas aprovadas no período depois de descontar a comissão do Mercado Livre e o frete pago pelo vendedor.',
  'Taxas e frete (ML)':
    'Soma da comissão do Mercado Livre e do frete pago pelo vendedor nas vendas do período.',
  Estornos:
    'Valor de vendas do período que foram reembolsadas, total ou parcialmente, ao comprador.',
  'Ticket médio líquido':
    'Valor líquido (já descontadas as taxas do ML) recebido por pedido, em média. Diferente do "Ticket médio" de outras telas, que usa o valor bruto.',
  'Já liberado':
    'Parte do líquido destas vendas que já caiu no seu saldo do Mercado Pago.',
  'A liberar':
    'Parte do líquido destas vendas que ainda está pendente de liberação pelo Mercado Pago.',
  'Vendas no período':
    'Número de pedidos aprovados no período.',
  'Lucro líquido no período':
    'Líquido menos custo menos imposto, somado sobre as vendas do período com custo cadastrado.',

  // ── Faturamento / aba Vendas ──────────────────────────────────────────
  'Faturamento::Faturamento/Vendas':
    'Soma do valor bruto dos pedidos aprovados no período, contando o pedido inteiro pelo status de uma venda representante do carrinho. Pode diferir do "Faturamento" de Publicados em carrinhos com status misto.',
  Líquido:
    'Valor líquido recebido dos pedidos aprovados no período, já descontadas comissão e frete.',
  'Pedidos::Faturamento/Vendas':
    'Número de pedidos aprovados no período, contando cada carrinho (pack) como 1 — o pedido inteiro conta pelo status de uma venda representante do carrinho.',
  Unidades:
    'Total de unidades vendidas nos pedidos do período.',
  'Ticket médio::Faturamento/Vendas':
    'Valor bruto do pedido no checkout, somado e dividido pelo número de pedidos aprovados.',
  'Itens / pedido':
    'Média de itens (linhas de produto) por pedido no período.',
  Markup:
    '(Líquido recebido − imposto − custo) ÷ custo de cada pedido, somado sobre os pedidos do período com custo cadastrado.',

  // ── Faturamento / aba Geografia ───────────────────────────────────────
  'Estados atingidos':
    'Número de estados (UF) diferentes com pelo menos 1 pedido no período.',
  'Top estado':
    'Estado com mais pedidos no período, e o quanto ele representa do total.',
  Cidades:
    'Número de cidades diferentes com pelo menos 1 pedido no período.',
  'Sem localização':
    'Pedidos do período sem UF identificada — o endereço de entrega não veio disponível pela API do Mercado Livre.',

  // ── Páginas de detalhe (drill-down) ───────────────────────────────────
  'Líquido total (você recebe)':
    'Soma do líquido de todas as vendas listadas nesta tela — mesmo valor do card "Líquido das vendas" de Financeiro, com o detalhamento por venda logo abaixo.',
  'Faturamento total':
    'Soma do valor bruto de todas as vendas listadas nesta tela, dividido entre anúncios publicados pelo PubliAI e vendas fora do PubliAI.',
};

/** Resolve a descrição de um KPI pelo `label` (ou `infoKey` composto). undefined = sem entrada
 *  no dicionário — o chamador (`KpiInfoButton`) trata isso como "não mostrar ícone". */
export function getKpiDescription(key: string): string | undefined {
  return KPI_DESCRIPTIONS[key];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/__tests__/kpi-descriptions.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/kpi-descriptions.ts src/lib/__tests__/kpi-descriptions.test.ts
git commit -m "feat: add central KPI description dictionary with coverage guard"
```

---

## Task 3: Extend `KpiCard` with `size`/`tom`/`infoKey` + `KpiInfoButton`

**Files:**
- Modify: `src/components/ui/kpi-card.tsx`

**Critical constraint, read before writing code:** the 4 duplicated local `Kpi` components being migrated in Tasks 4–7 render a **plain `<div>`** with manual classes (`rounded-lg border bg-card px-3 py-2.5 shadow-sm ...`), NOT the shared `<Card>` primitive. `Card` (`src/components/ui/card.tsx`) applies `flex flex-col gap-4 py-4` unconditionally — if `size="compact"` reuses `<Card>`, every migrated card gets an extra 16px gap between the label row / value / delta / hint that the original tight compact cards never had. **`size="compact"` must render a bare `<div>`, not `<Card>`.** `size="default"` (today's only mode) keeps using `<Card>` exactly as-is — don't touch that path's structure.

Also preserve, exactly as today, that the compact cards stack `delta` and `hint`/`sub` as **two separate lines** (see `Financeiro.tsx`'s old "Lucro líquido no período" card, which has both at once) — don't merge them into the single-row layout the default-size card uses for `delta`+`hint`.

- [ ] **Step 1: Replace the file contents**

```tsx
import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowDown, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getKpiDescription } from '@/lib/kpi-descriptions';

export type DeltaTrend = 'up' | 'down' | 'neutral';
export type KpiTom = 'info' | 'success' | 'warning' | 'danger';

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: ComponentType<{ className?: string }>;
  delta?: string;
  deltaTrend?: DeltaTrend;
  hint?: string;
  loading?: boolean;
  className?: string;
  /** Classe aplicada ao valor (ex.: cor verde/vermelha do markup). */
  valueClassName?: string;
  variant?: 'default' | 'brand';
  /** Quando presente, o card vira um link navegável (drill-down) com affordance. */
  to?: string;
  /** 'compact' reproduz o card pequeno hoje duplicado em Publicados/Financeiro/Faturamento. */
  size?: 'default' | 'compact';
  /** Cor do ícone/label — só tem efeito em size="compact" (default visual não usa `tom`). */
  tom?: KpiTom;
  /** Chave no dicionário de descrições (default: usa o próprio `label`). Só precisa ser passada
   *  explicitamente pelos KPIs cujo cálculo diverge entre telas — ver kpi-descriptions.ts. */
  infoKey?: string;
}

/**
 * Ícone "i" clicável que abre um popover com a explicação do KPI. Não renderiza nada se a chave
 * não tiver descrição no dicionário (silencioso de propósito — ver o teste de guarda de
 * cobertura em kpi-descriptions.test.ts, que garante que todo KPI em produção tem entrada).
 */
export function KpiInfoButton({ infoKey, tom }: { infoKey: string; tom?: KpiTom }) {
  const texto = getKpiDescription(infoKey);
  if (!texto) return null;
  const titulo = infoKey.split('::')[0];
  const tomCls = tom === 'success' ? 'text-success' : tom === 'warning' ? 'text-warning'
    : tom === 'danger' ? 'text-destructive' : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`O que é ${titulo}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full p-1.5 -m-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground',
            tomCls,
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm font-semibold text-foreground">{titulo}</div>
        <p className="text-muted-foreground">{texto}</p>
      </PopoverContent>
    </Popover>
  );
}

export function KpiCard({
  label, value, icon: Icon, delta, deltaTrend = 'neutral', hint, loading, className, valueClassName,
  variant = 'default', to, size = 'default', tom, infoKey,
}: KpiCardProps) {
  const compact = size === 'compact';

  if (loading) {
    return compact ? (
      <div className={cn('h-full rounded-lg border bg-card px-3 py-2.5 shadow-sm', className)}>
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-2 h-6 w-16" />
      </div>
    ) : (
      <Card className={cn('h-full p-4', className)}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-8 w-20" />
      </Card>
    );
  }

  const trendCls =
    deltaTrend === 'up' ? 'text-success' : deltaTrend === 'down' ? 'text-destructive' : 'text-muted-foreground';
  const TrendIcon = deltaTrend === 'up' ? ArrowUp : deltaTrend === 'down' ? ArrowDown : null;
  const tomCls = tom === 'success' ? 'text-success' : tom === 'warning' ? 'text-warning'
    : tom === 'danger' ? 'text-destructive' : 'text-info';

  const valueEl = (
    <div className={cn(compact ? 'text-lg' : 'mt-2 text-2xl', 'font-semibold tabular-nums tracking-tight', valueClassName)}>
      {value}
    </div>
  );

  const deltaHintEl = compact ? (
    <>
      {delta && (
        <div className={cn('mt-0.5 flex items-center gap-0.5 text-xs', trendCls)}>
          {TrendIcon && <TrendIcon className="h-3 w-3" />}
          {delta}
        </div>
      )}
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </>
  ) : (
    (delta || hint) && (
      <div className="mt-1 flex items-center gap-1 text-xs">
        {delta && (
          <span className={cn('inline-flex items-center gap-0.5 font-medium', trendCls)}>
            {TrendIcon && <TrendIcon className="h-3 w-3" />}
            {delta}
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    )
  );

  const content = compact ? (
    <>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className={cn('h-3.5 w-3.5 shrink-0', tomCls)} />}
        <span className={tomCls}>{label}</span>
        <KpiInfoButton infoKey={infoKey ?? label} tom={tom} />
      </div>
      {valueEl}
      {deltaHintEl}
    </>
  ) : (
    <>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {label}
          <KpiInfoButton infoKey={infoKey ?? label} />
        </span>
        {Icon && (
          <span className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-lg',
            variant === 'brand'
              ? 'bg-[image:var(--brand-gradient)] text-primary-foreground shadow-brand'
              : 'text-muted-foreground'
          )}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      {valueEl}
      {deltaHintEl}
    </>
  );

  const card = compact ? (
    <div className={cn(
      'h-full rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110',
      to && 'cursor-pointer',
      className,
    )}>
      {content}
    </div>
  ) : (
    <Card className={cn(
      'h-full p-4 transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110',
      variant === 'brand' && 'bg-[image:var(--brand-gradient-soft)]',
      to && 'cursor-pointer hover:-translate-y-0.5 hover:ring-2 hover:ring-primary/40',
      className,
    )}>
      {content}
    </Card>
  );

  return to ? (
    <Link
      to={to}
      aria-label={`${label} — ver detalhes`}
      className="block h-full rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
    >
      {card}
    </Link>
  ) : (
    card
  );
}
```

- [ ] **Step 2: Verify the Dashboard still renders correctly (its `KpiCard size="default"` usages are unchanged in props, but the file changed)**

Run: `pnpm exec tsc --noEmit -p .`
Expected: no new type errors. (`Dashboard.tsx`'s existing `KpiCard` calls don't pass `size`/`tom`, so they default to `size="default"` — same visual as before, now with an "i" icon added automatically wherever the label matches a dictionary entry.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/kpi-card.tsx
git commit -m "feat: extend KpiCard with size/tom/infoKey and add KpiInfoButton"
```

---

## Task 4: Migrate `dashboard-publicados.tsx`

**Files:**
- Modify: `src/components/dashboard-publicados.tsx`

- [ ] **Step 1: Remove the local `Kpi` function, import `KpiCard`/`KpiInfoButton`**

Remove lines 29-42 (`function Kpi(...)`). Add to the imports:

```tsx
import { KpiCard, KpiInfoButton } from '@/components/ui/kpi-card';
```

- [ ] **Step 2: Replace the "Vendas" row (lines 66-94)**

```tsx
      {/* Vendas */}
      <div className={cn('grid grid-cols-2 gap-3', temCusto ? 'sm:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-4')}>
        <Link
          to={{ pathname: '/publicados/vendas', search: queryDetalhe }}
          className="group cursor-pointer rounded-lg outline-none ring-offset-background transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Faturamento — ver composição"
          onClick={(e) => {
            // O KpiInfoButton dentro do card já faz stopPropagation no próprio clique; isto aqui
            // é só a documentação de por que esse handler existe caso alguém precise debugar.
          }}
        >
          <KpiCard size="compact" icon={DollarSign} label="Faturamento" infoKey="Faturamento::Publicados" value={fmtBRL(totais.faturamento)} tom="success" />
        </Link>
        <KpiCard size="compact" icon={Package} label="Unidades vendidas" value={String(totais.unidades)} />
        <KpiCard size="compact" icon={Receipt} label="Pedidos" infoKey="Pedidos::Publicados" value={String(totais.pedidos)} />
        <KpiCard size="compact" icon={Target} label="Ticket médio" infoKey="Ticket médio::Publicados" value={fmtBRL(ticket)} />
        {temCusto && (
          <KpiCard
            size="compact"
            icon={TrendingUp}
            label="Markup no período"
            value={(markupPct >= 0 ? '+' : '') + Math.round(markupPct * 100) + '%'}
            valueClassName={markupPct >= 0 ? 'text-success' : 'text-destructive'}
          />
        )}
        {temCusto && lucro != null && (
          <KpiCard
            size="compact"
            icon={Coins}
            label="Lucro no período"
            value={fmtBRL(lucro)}
            valueClassName={lucro >= 0 ? 'text-success' : 'text-destructive'}
          />
        )}
      </div>
```

Drop the empty `onClick` you see above — it was scaffolding for the note; **do not actually add an empty `onClick` to the `<Link>`**. The real fix is that `KpiInfoButton`'s own `onClick={(e) => e.stopPropagation()}` (already in Task 3's code) prevents its click from ever reaching the `<Link>`, so the `<Link>` itself needs no changes at all here. (This note exists because the design spec calls this case out explicitly — worth double-checking in Step 5's manual test that clicking the "i" on the "Faturamento" card does NOT navigate to `/publicados/vendas`.)

- [ ] **Step 3: Add `KpiInfoButton` to the 3 panels (lines 96-161 in the original)**

```tsx
      {/* Saúde + Encalhados + Rankings */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Saúde dos anúncios
            <KpiInfoButton infoKey="Saúde dos anúncios" />
          </div>
          <div className="flex items-center justify-between">
            <span>Ativos</span>
            <span className="font-semibold tabular-nums text-success">{resumo.ativos}/{resumo.total}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Com problema</span>
            <span className="font-semibold tabular-nums text-warning">{resumo.comProblema}</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <span className="flex items-center gap-1 text-info"><Layers className="h-3.5 w-3.5" /> Variações publicadas</span>
            <span className="font-semibold tabular-nums text-info">{resumo.variacoesPublicadas}</span>
          </div>
        </div>

        {/* Encalhados: card clicável que filtra a lista (toggle). */}
        <button
          type="button"
          onClick={onToggleEncalhados}
          aria-pressed={!!somenteEncalhados}
          disabled={!onToggleEncalhados}
          className={cn(
            'rounded-lg border bg-card px-3 py-2.5 text-left text-sm shadow-sm transition-all duration-200',
            onToggleEncalhados && 'cursor-pointer hover:shadow-md hover:brightness-105 dark:hover:brightness-110',
            somenteEncalhados
              ? 'border-warning ring-2 ring-warning/40'
              : 'hover:border-warning/50',
          )}
        >
          <div className="mb-2 flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <PackageX className="h-3.5 w-3.5 text-warning" /> Encalhados (sem venda no período)
              <KpiInfoButton infoKey="Encalhados (sem venda no período)" />
            </span>
            {somenteEncalhados && <span className="font-medium text-warning">• filtrando</span>}
          </div>
          <div className="text-2xl font-semibold tabular-nums">{resumo.encalhados}</div>
          <div className="text-xs text-muted-foreground">
            {somenteEncalhados
              ? 'clique para mostrar todos de novo'
              : `de ${resumo.ativos} ativo(s) — clique para ver só os encalhados`}
          </div>
        </button>

        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-info" /> Top produtos (faturamento)
            <KpiInfoButton infoKey="Top produtos (faturamento)" />
          </div>
          {resumo.topFat.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem vendas no período.</div>
          ) : (
            <ul className="space-y-1">
              {resumo.topFat.map((i) => (
                <li key={i.familiaId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate" title={i.titulo}>{i.titulo}</span>
                  <span className="shrink-0 font-medium tabular-nums">{fmtBRL(i.valorVendido ?? 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
```

The "Encalhados" card is a `<button>`, and `KpiInfoButton` renders its own `<button>` inside it — same nested-button situation as the `<Link>` case above. `KpiInfoButton`'s `stopPropagation` handles it the same way (clicking the info icon won't toggle the encalhados filter). Confirm this specifically in the manual QA step.

- [ ] **Step 4: Add the new keys to the coverage-guard test if not already there**

`Faturamento::Publicados`, `Pedidos::Publicados`, `Ticket médio::Publicados`, `Unidades vendidas`, `Lucro no período`, `Saúde dos anúncios`, `Encalhados (sem venda no período)`, `Top produtos (faturamento)` are already in `ALL_EXPECTED_KEYS` from Task 2 — just re-run the test to confirm nothing's missing.

Run: `pnpm test src/lib/__tests__/kpi-descriptions.test.ts`
Expected: PASS

- [ ] **Step 5: Build check + manual smoke test**

Run: `pnpm exec tsc --noEmit -p .`
Expected: no errors.

Manual (dev server, `pnpm dev`, navigate to Publicados): all 6 KPI cards + 3 panels show an "i" icon; clicking each opens a popover; clicking the "i" on "Faturamento" does not navigate to `/publicados/vendas`; clicking the "i" on the "Encalhados" panel does not toggle the filter.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard-publicados.tsx
git commit -m "refactor: migrate Publicados KPIs to shared KpiCard with info icon"
```

---

## Task 5: Migrate `Financeiro.tsx`

**Files:**
- Modify: `src/pages/Financeiro.tsx`

- [ ] **Step 1: Remove the local `Kpi` function (lines 19-45), import `KpiCard`/`KpiInfoButton`**

```tsx
import { KpiCard, KpiInfoButton } from '@/components/ui/kpi-card';
```

- [ ] **Step 2: Add `KpiInfoButton` to the hero card (both branches — `podeDetalhar` true/false)**

```tsx
      {/* Destaque: líquido das vendas */}
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {podeDetalhar ? (
          <Link
            to={{ pathname: '/financeiro/detalhe', search: queryDetalhe }}
            className="group block cursor-pointer rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm outline-none ring-offset-background transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Líquido das vendas — ver composição"
          >
            <div className="mb-1 flex items-center justify-between gap-1.5 text-xs text-success">
              <span className="flex items-center gap-1.5">
                <Wallet className="h-4 w-4 shrink-0" /> Líquido das vendas (você recebe)
                <KpiInfoButton infoKey="Líquido das vendas (você recebe)" />
              </span>
              <span className="flex items-center gap-0.5 text-muted-foreground">
                Ver detalhe <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
            <div className="text-3xl font-bold tabular-nums text-success">{fmtBRL(r?.liquido ?? 0)}</div>
            <HeroDeltaBar />
            <div className="mt-1 text-xs text-muted-foreground">
              de {fmtBRL(r?.bruto ?? 0)} faturados — {pctRetido.toFixed(1).replace('.', ',')}% retido pelo ML
            </div>
          </Link>
        ) : (
          <div className="rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-success">
              <Wallet className="h-4 w-4 shrink-0" /> Líquido das vendas (você recebe)
              <KpiInfoButton infoKey="Líquido das vendas (você recebe)" />
            </div>
            <div className="text-3xl font-bold tabular-nums text-success">{fmtBRL(r?.liquido ?? 0)}</div>
            <HeroDeltaBar />
            <div className="mt-1 text-xs text-muted-foreground">
              de {fmtBRL(r?.bruto ?? 0)} faturados — {pctRetido.toFixed(1).replace('.', ',')}% retido pelo ML
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <KpiCard size="compact" icon={Receipt} label="Faturamento bruto" value={fmtBRL(r?.bruto ?? 0)} delta={delta(r.bruto, rAnt.bruto).texto} deltaTrend={delta(r.bruto, rAnt.bruto).trend} />
          <KpiCard size="compact" icon={Percent} label="Taxas e frete (ML)" value={fmtBRL(r?.descontos ?? 0)} tom="warning" hint={`comissão ${fmtBRL(r?.comissao ?? 0)} · frete ${fmtBRL(r?.frete ?? 0)}`} />
          <KpiCard size="compact" icon={RotateCcw} label="Estornos" value={fmtBRL(r?.estornos ?? 0)} tom="danger" />
          <KpiCard size="compact" icon={Target} label="Ticket médio líquido" value={fmtBRL(ticketLiquido)} />
        </div>
      </div>
```

- [ ] **Step 3: Replace the remaining two KPI rows (lines 223-273 in the original)**

```tsx
      {/* Caixa: liberação dos recebimentos destas vendas (NÃO é o "A receber" do MP) */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard
          size="compact"
          icon={Wallet}
          label="Já liberado"
          value={fmtBRL(r?.liberado ?? 0)}
          tom="success"
          hint="recebimentos destas vendas já no saldo"
        />
        <KpiCard
          size="compact"
          icon={CalendarClock}
          label="A liberar"
          value={fmtBRL(r?.aLiberar ?? 0)}
          tom="warning"
          hint={r?.proximaLiberacao
            ? `próxima em ${new Date(r.proximaLiberacao).toLocaleDateString('pt-BR')}`
            : 'nada pendente de liberação'}
        />
      </div>

      {/* Quantidade de vendas + markup do período */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard
          size="compact"
          icon={ShoppingBag}
          label="Vendas no período"
          value={fmtInt(r.pedidos)}
          tom="info"
          delta={delta(r.pedidos, rAnt.pedidos).texto}
          deltaTrend={delta(r.pedidos, rAnt.pedidos).trend}
        />
        <KpiCard
          size="compact"
          icon={TrendingUp}
          label="Markup no período"
          value={markup ? `${markup.pct >= 0 ? '+' : ''}${Math.round(markup.pct * 100)}%` : '—'}
          valueClassName={markup ? (markup.pct >= 0 ? 'text-success' : 'text-destructive') : undefined}
          tom={markup && markup.pct < 0 ? 'danger' : 'success'}
          hint={markup
            ? `lucro ${fmtBRL(markup.lucro)} · ${markup.n} venda(s) c/ custo`
            : 'sem custo cadastrado nas vendas'}
        />
        <KpiCard
          size="compact"
          icon={Coins}
          label="Lucro líquido no período"
          value={r.margem != null ? fmtBRL(r.lucro) : '—'}
          valueClassName={r.margem != null ? (r.lucro >= 0 ? 'text-success' : 'text-destructive') : undefined}
          tom={r.margem != null && r.lucro < 0 ? 'danger' : 'success'}
          delta={delta(r.lucro, rAnt.lucro).texto}
          deltaTrend={delta(r.lucro, rAnt.lucro).trend}
          hint={r.margem != null
            ? `margem ${Math.round(r.margem * 100)}%${r.imposto > 0 ? ` · imposto ${fmtBRL(r.imposto)}` : ''} · sobre ${r.vendasComCusto}/${r.totalVendas} venda(s) c/ custo`
            : 'sem custo cadastrado nas vendas'}
        />
      </div>
```

Note the `delta` prop shape changed: the old local `Kpi` took `delta={{ texto, trend }}` as one object; `KpiCard` takes `delta={string}` and `deltaTrend={trend}` as two separate props — every call site above already unpacks `.texto`/`.trend` accordingly. Don't miss any.

- [ ] **Step 4: Build check + manual smoke test**

Run: `pnpm exec tsc --noEmit -p .`
Expected: no errors.

Manual: open Financeiro, confirm every card (hero + 8 KpiCards) shows an "i", popovers open with the right text, and clicking the hero card's "i" does not navigate to `/financeiro/detalhe` (test both the `podeDetalhar` true and false paths if you can — false only happens when there are 0 pedidos in the period, e.g. pick a period with no sales, or trust the code review since both branches got the same treatment).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Financeiro.tsx
git commit -m "refactor: migrate Financeiro KPIs to shared KpiCard with info icon"
```

---

## Task 6: Migrate `aba-vendas.tsx`

**Files:**
- Modify: `src/components/faturamento/aba-vendas.tsx`

- [ ] **Step 1: Remove the local `Kpi` function (lines 86-103), import `KpiCard`**

```tsx
import { KpiCard } from '@/components/ui/kpi-card';
```

(No `KpiInfoButton` direct import needed here — this file only uses `KpiCard`, no standalone panels.)

- [ ] **Step 2: Replace the KPI grid (lines 370-383)**

```tsx
      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard size="compact" icon={DollarSign} label="Faturamento" infoKey="Faturamento::Faturamento/Vendas" value={fmtBRL(kpis.bruto)} tom="success" />
        <KpiCard size="compact" icon={DollarSign} label="Líquido" value={fmtBRL(kpis.liquido)} tom="success" valueClassName="text-success" />
        <KpiCard size="compact" icon={ShoppingBag} label="Pedidos" infoKey="Pedidos::Faturamento/Vendas" value={fmtInt(kpis.pedidos)} tom="info" />
        <KpiCard size="compact" icon={Package} label="Unidades" value={fmtInt(kpis.unidades)} tom="info" />
        <KpiCard size="compact" icon={Target} label="Ticket médio" infoKey="Ticket médio::Faturamento/Vendas" value={fmtBRL(kpis.ticket)} tom="info" />
        <KpiCard size="compact" icon={Layers} label="Itens / pedido" value={kpis.itensPorPedido.toFixed(1).replace('.', ',')} tom="info" />
        <KpiCard size="compact" icon={TrendingUp} label="Markup" value={kpis.markup != null ? fmtMarkup(kpis.markup) : '—'}
          tom={kpis.markup == null ? 'info' : kpis.markup >= 0 ? 'success' : 'danger'}
          valueClassName={markupCor} />
        <KpiCard size="compact" icon={Users} label="Compradores" value={fmtInt(kpis.compradoresUnicos)} tom="info"
          hint={`${kpis.pctRecompra.toFixed(1).replace('.', ',')}% recompra`} />
      </div>
```

(`valorCor`/`valor` renamed to `valueClassName`/`value` — `KpiCard`'s prop names, not the old local `Kpi`'s. `sub` renamed to `hint`.)

- [ ] **Step 3: Build check + manual smoke test**

Run: `pnpm exec tsc --noEmit -p .`
Expected: no errors.

Manual: open Faturamento → aba Vendas, confirm all 8 cards show "i" and popovers open with correct text — especially confirm "Faturamento", "Pedidos" and "Ticket médio" here show DIFFERENT text than the same-named cards in Publicados (composite keys working).

- [ ] **Step 4: Commit**

```bash
git add src/components/faturamento/aba-vendas.tsx
git commit -m "refactor: migrate Faturamento/Vendas KPIs to shared KpiCard with info icon"
```

---

## Task 7: Migrate `aba-geografia.tsx`

**Files:**
- Modify: `src/components/faturamento/aba-geografia.tsx`

- [ ] **Step 1: Remove the local `Kpi` function (lines 30-50), import `KpiCard`**

```tsx
import { KpiCard } from '@/components/ui/kpi-card';
```

- [ ] **Step 2: Replace the KPI grid (lines 134-164)**

```tsx
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          size="compact"
          icon={MapPin}
          label="Estados atingidos"
          value={fmtInt(geo.estadosAtingidos)}
          tom="info"
        />
        <KpiCard
          size="compact"
          icon={Building2}
          label="Top estado"
          value={topUf?.uf ?? '—'}
          tom="success"
          hint={topUfSub}
        />
        <KpiCard
          size="compact"
          icon={Building2}
          label="Cidades"
          value={fmtInt(geo.porCidade.length)}
          tom="info"
        />
        {geo.semGeo > 0 && (
          <KpiCard
            size="compact"
            icon={AlertCircle}
            label="Sem localização"
            value={fmtInt(geo.semGeo)}
            tom="warning"
            hint="pedidos sem UF"
          />
        )}
      </div>
```

- [ ] **Step 3: Build check + manual smoke test**

Run: `pnpm exec tsc --noEmit -p .`
Expected: no errors.

Manual: open Faturamento → aba Geografia (com um período que tenha vendas), confirm all 4 cards (or 3, if `geo.semGeo === 0`) show "i" with correct text.

- [ ] **Step 4: Commit**

```bash
git add src/components/faturamento/aba-geografia.tsx
git commit -m "refactor: migrate Faturamento/Geografia KPIs to shared KpiCard with info icon"
```

---

## Task 8: `Dashboard.tsx` — `HeroVenda` + explicit `infoKey` for divergent labels

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Add `KpiInfoButton` to `HeroVenda` (lines 52-89)**

```tsx
import { KpiCard, KpiInfoButton } from '@/components/ui/kpi-card';
// (KpiCard import already exists at line 11 — just add KpiInfoButton to it)

/** Card de destaque do topo (Faturamento / Líquido). Gradiente de marca, valor grande, delta e
 *  drill-down para a tela de origem. */
function HeroVenda({ to, destino, icon: Icon, label, cor, valor, valorCor, delta, sub, className }: {
  to: string;
  destino: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  cor: string;
  valor: string;
  valorCor?: string;
  delta: { texto: string; trend: Trend };
  sub: string;
  className?: string;
}) {
  return (
    <Link
      to={to}
      aria-label={`${label} — ver ${destino}`}
      className={cn('group block h-full rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm outline-none ring-offset-background transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <div className="mb-1 flex items-center justify-between gap-1.5 text-xs">
        <span className={cn('flex items-center gap-1.5', cor)}>
          <Icon className="h-4 w-4 shrink-0" /> {label}
          <KpiInfoButton infoKey={label} />
        </span>
        <span className="flex items-center gap-0.5 text-muted-foreground">
          {destino} <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
      <div className={cn('text-3xl font-bold tabular-nums', valorCor)}>{valor}</div>
      <div className={cn('mt-0.5 flex items-center gap-0.5 text-xs',
        delta.trend === 'up' ? 'text-success' : delta.trend === 'down' ? 'text-destructive' : 'text-muted-foreground')}>
        {delta.trend === 'up' ? <ArrowUp className="h-3 w-3" /> : delta.trend === 'down' ? <ArrowDown className="h-3 w-3" /> : null}
        {delta.texto}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </Link>
  );
}
```

`HeroVenda`'s two call sites pass `label="Faturamento bruto"` and `label="Líquido das vendas"` — both are simple (non-composite) dictionary keys, so `infoKey={label}` (== defaulting to the label, same as `KpiCard` does internally) is correct without any other change.

- [ ] **Step 2: Pass explicit `infoKey` to the 2 divergent `KpiCard` usages (lines 300-309 in the original)**

```tsx
        <KpiCard
          label="Pedidos" icon={ShoppingBag} loading={carregando} to="/faturamento"
          infoKey="Pedidos::Dashboard"
          value={fmtInt(kpisPedidos.pedidos)}
          delta={delta(kpisPedidos.pedidos, kpisPedidosAnt.pedidos).texto} deltaTrend={delta(kpisPedidos.pedidos, kpisPedidosAnt.pedidos).trend}
        />
        <KpiCard
          label="Ticket médio" icon={Target} loading={carregando} to="/faturamento"
          infoKey="Ticket médio::Dashboard"
          value={fmtBRL(kpisPedidos.ticket)}
          delta={delta(kpisPedidos.ticket, kpisPedidosAnt.ticket).texto} deltaTrend={delta(kpisPedidos.ticket, kpisPedidosAnt.ticket).trend}
        />
```

The other 4 `KpiCard` usages on this page ("Líquido no faturamento", "Markup no período", "Compradores", "A receber") need **no changes** — they're all simple (non-divergent) keys, so `KpiCard`'s internal `infoKey ?? label` default already resolves them correctly.

- [ ] **Step 3: Build check + manual smoke test**

Run: `pnpm exec tsc --noEmit -p .`
Expected: no errors.

Manual: open Dashboard, confirm both `HeroVenda` cards and all 6 `KpiCard`s show "i"; clicking the "i" on either `HeroVenda` does not navigate; "Pedidos"/"Ticket médio" popovers here mention "menu Faturamento" / pack-based counting (the Dashboard-specific composite text), not the Publicados-specific text.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat: add info icon to Dashboard HeroVenda and divergent KpiCard labels"
```

---

## Task 9: Drill-down "Resumo" cards

**Files:**
- Modify: `src/pages/DetalheFinanceiro.tsx`
- Modify: `src/pages/DetalheVendas.tsx`

Neither card has a `<Link>`/`<button>` ancestor (they're already the destination page), so no `stopPropagation` concern here — just drop the button in.

- [ ] **Step 1: `DetalheFinanceiro.tsx`**

Add to imports:
```tsx
import { KpiInfoButton } from '@/components/ui/kpi-card';
```

Replace the "Resumo" block (lines 452-460):
```tsx
      {/* Resumo */}
      <div className="mb-5 rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Líquido total (você recebe)
            <KpiInfoButton infoKey="Líquido total (você recebe)" />
          </span>
          <span className="text-2xl font-bold tabular-nums text-success">{fmtBRL(liquido)}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          de {fmtBRL(bruto)} faturados — {pct(pctRetido)} retido pelo ML · {fmtInt(r.pedidos)} venda(s)
        </div>
      </div>
```

- [ ] **Step 2: `DetalheVendas.tsx`**

Add to imports:
```tsx
import { KpiInfoButton } from '@/components/ui/kpi-card';
```

Replace the "Resumo" block (lines 362-378):
```tsx
      {/* Resumo */}
      <div className="mb-5 rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Faturamento total
            <KpiInfoButton infoKey="Faturamento total" />
          </span>
          <span className="text-2xl font-bold tabular-nums text-success">{fmtBRL(detalhe.total)}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{fmtInt(detalhe.pedidos)} pedidos no período</div>
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span>Seus anúncios (PubliAI)</span>
            <span className="tabular-nums">{fmtBRL(detalhe.app.valor)} <span className="text-muted-foreground">({pct(detalhe.app.pctTotal)})</span></span>
          </div>
          <div className="flex items-center justify-between">
            <span>Fora do PubliAI</span>
            <span className="tabular-nums">{fmtBRL(detalhe.externo.valor)} <span className="text-muted-foreground">({pct(detalhe.externo.pctTotal)})</span></span>
          </div>
        </div>
      </div>
```

- [ ] **Step 3: Build check + manual smoke test**

Run: `pnpm exec tsc --noEmit -p .`
Expected: no errors.

Manual: from Financeiro, click into "Líquido das vendas" → confirm the "Resumo" card on `/financeiro/detalhe` shows an "i" with matching text. From Publicados, click into "Faturamento" → confirm `/publicados/vendas`'s "Resumo" card shows an "i".

- [ ] **Step 4: Commit**

```bash
git add src/pages/DetalheFinanceiro.tsx src/pages/DetalheVendas.tsx
git commit -m "feat: add info icon to detail-page Resumo cards"
```

---

## Task 10: `docs/TASKS.md` note about the pipeline divergence

**Files:**
- Modify: `docs/TASKS.md`

This is documentation debt, not a code fix — per the spec's explicit scope boundary (fixing the pipeline divergence itself is out of scope for this branch and would need its own ADR).

- [ ] **Step 1: Read the current file structure**

Run: `head -60 docs/TASKS.md` to see the existing format/section this note should go under (follow the file's own conventions for how open items are listed — don't invent a new format).

- [ ] **Step 2: Add an entry**

Add a note (matching the existing list style in the file) along these lines:

> **Divergência de pipeline entre "Pedidos"/"Ticket médio"/"Faturamento" em Publicados vs. Dashboard/Faturamento** — `calcularResumo()` (`lib/resumo-vendas.ts`) filtra "faturável" por linha antes de agrupar em pack; `agruparPorPedido()`+`calcularKpisPedidos()` (`lib/pedidos-faturamento.ts`) filtra pelo status de uma linha representante do pack inteiro. Em packs com status misto (1 item cancelado + 1 pago no mesmo carrinho), os dois pipelines podem contar o pack de forma diferente — contradiz o que o ADR-0038 promete ("mesmo número em todas as telas"). Achado durante o design do ícone de informação nos KPIs (docs/superpowers/specs/2026-07-17-kpi-info-tooltip-design.md). Não corrigido nesta entrega — precisa de ADR próprio antes de unificar os pipelines.

- [ ] **Step 3: Commit**

```bash
git add docs/TASKS.md
git commit -m "docs: registrar divergência de pipeline Pedidos/Ticket médio/Faturamento em TASKS.md"
```

---

## Task 11: Final validation

**Files:** none (verification only)

- [ ] **Step 1: Full lint + test suite**

Run: `pnpm lint && pnpm test`
Expected: both pass, no new warnings/errors.

- [ ] **Step 2: Type check**

Run: `pnpm exec tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Full manual QA pass (browser-use or manual browser), per the spec's Validação section**

Open each screen in both light and dark mode; for each KPI card / panel, click the "i" and confirm:
- Popover opens with a title matching the label and 1-2 sentences of accurate text.
- Popover closes on outside click and on Esc.
- Clicking the "i" never triggers navigation or an unrelated toggle, specifically re-check: Dashboard (`HeroVenda` ×2, "Compradores"/"Pedidos"/"Ticket médio"/"Líquido no faturamento" — all have `to`), Publicados ("Faturamento" inside external `<Link>`, "Encalhados" inside a toggle `<button>`), Financeiro (hero card, `podeDetalhar` true branch).
- Every card that should have an "i" has one (cross-check against the `ALL_EXPECTED_KEYS` list in `kpi-descriptions.test.ts` — nothing in that list should be visually missing its icon).
- The touch target for the icon is reasonably larger than the visible glyph (padding, not just the 14px icon) — check on a narrow/mobile viewport.

- [ ] **Step 4: Confirm no `docs/` update is needed beyond what Task 10 already did**

This feature doesn't touch Edge Functions, migrations, domain terms, or architecture — per CLAUDE.md's doc-maintenance table, the only relevant row is "nova decisão arquitetural" (not applicable, no ADR needed for this feature per the spec) and the `TASKS.md` update already done in Task 10. State explicitly in the final report: "documentação conferida, nenhuma atualização adicional necessária além da nota em TASKS.md."

- [ ] **Step 5: If everything above passes, this branch is ready for Diego to review locally per the project's delivery workflow (branch → Diego valida local → commit/push só sob OK) — do not push or open a PR without being asked.**
