# Faturamento Fase 1 — Visão por pedido (pack) + KPIs operacionais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a aba Vendas do menu Faturamento para listar **um pedido por linha** (agrupando `order_id` por `pack_id`), com os produtos no detalhe, **markup líquido por pedido e por produto**, e KPIs operacionais novos — tudo client-side, sem tocar backend.

**Architecture:** Um agregador puro (`agruparPorPedido`) transforma o `Venda[]` (já carregado por `useVendas` da tabela `ml_vendas`) numa lista de `Pedido[]`, agrupando por `pack_id ?? order_id`, reaproveitando o rateio de frete existente (`ratearLiquidoPorFrete`) e o custo (`useCustos`/`montarCustoResolver`). A aba Vendas passa a renderizar `Pedido` (linha) + `ItemPedido` (detalhe). KPIs derivam de `calcularKpisPedidos`. Nenhuma migration/edge function.

**Tech Stack:** React 18 + TypeScript + Vite, vitest + @testing-library/react, Tailwind/shadcn. Gerência de dados via TanStack Query (hooks existentes `useVendas`/`useCustos`).

## Global Constraints

- **TDD obrigatório:** RED (teste falha) → GREEN (mínimo p/ passar) → commit. Nunca implementar sem teste antes nas tarefas de lógica pura.
- **Comandos:** testes `pnpm test`, build `pnpm build`, lint `pnpm lint`. Rodar do diretório do worktree.
- **Isolamento:** todo o trabalho nesta branch/worktree (`worktree-adr-faturamento-por-pedido`). App em produção — não editar a main direto.
- **Commits:** NÃO commitar/push sem o OK do Diego (regra do projeto). Os "Step: Commit" deste plano só executam após autorização explícita; até lá, acumular as mudanças.
- **Estilo:** seguir o código existente (densidade de comentários, nomes em pt-BR no domínio, `cn`, `fmtBRL`/`fmtInt`, componentes `Table`/`StatusPill` de `@/components/ui`).
- **Fonte única (ADR-0038):** não mudar a semântica de faturável (`ehFaturavel`: `paid`/`partially_refunded`/`refunded`); agrupar é só apresentação, os totais agregados NÃO mudam.
- **Valor do pedido = soma de `total_amount`** dos orders do grupo; **frete = max(`frete_vendedor`)** (uma vez por pack); **líquido = soma** do líquido (rateado) dos membros. Confirmado com dados reais (pack 2000013527501503: 5 orders, frete 40,4 repetido).

---

## File Structure

- **Create** `src/lib/pedidos-faturamento.ts` — agregador puro: `agruparPorPedido`, `calcularKpisPedidos`, tipos `Pedido`/`ItemPedido`/`KpisPedidos`.
- **Create** `tests/lib/pedidos-faturamento.test.ts` — testes do agregador e dos KPIs.
- **Modify** `src/lib/faturamento.ts` — adicionar `comprador_id` ao tipo `Venda` (a coluna já vem no `select('*')`).
- **Modify** `src/components/faturamento/aba-vendas.tsx` — renderizar `Pedido` na linha + `ItemPedido` no detalhe; coluna Markup; KPIs novos; contadores de status clicáveis (filtro).
- **Modify** `tests/components/` — novo `tests/components/aba-vendas-pedido.test.tsx` cobrindo: 1 linha por pack, detalhe com produtos+markup, KPI de pedidos reais.

---

### Task 1: Expor `comprador_id` no tipo `Venda` + agregador `agruparPorPedido`

**Files:**
- Modify: `src/lib/faturamento.ts` (interface `Venda`)
- Create: `src/lib/pedidos-faturamento.ts`
- Test: `tests/lib/pedidos-faturamento.test.ts`

**Interfaces:**
- Consumes: `Venda`/`VendaItem` (`@/lib/faturamento`); `ehFaturavel`, `ratearLiquidoPorFrete`, `CustoResolver`, `PesoResolver` (`@/lib/resumo-vendas`); `calcularMarkup` (`@/lib/markup`).
- Produces:
  - `interface ItemPedido { id; ml_item_id; titulo; codigo; cor; ean; quantity; unit_price; custo: number|null; liquido: number; markup: number|null }`
  - `interface Pedido { chave: string; isPack: boolean; orderIds: number[]; data: string|null; comprador_id: number|null; comprador_nick: string|null; status: string; statusDetail: string|null; shipping_status: string|null; unidades: number; bruto: number; frete: number|null; liquido: number; custo: number|null; markup: number|null; comissao: number; rastreio: string|null; is_publiai: boolean; tem_devolucao: boolean; itens: ItemPedido[] }`
  - `function agruparPorPedido(vendas: Venda[], custoResolver?: CustoResolver, pesoResolver?: PesoResolver): Pedido[]`

- [ ] **Step 1: Adicionar `comprador_id` ao tipo `Venda`**

Em `src/lib/faturamento.ts`, na interface `Venda`, logo após `comprador_nick: string | null;` adicionar:

```ts
  /** id numérico do comprador no ML (coluna ml_vendas.comprador_id), p/ detectar recompra. */
  comprador_id: number | null;
```

- [ ] **Step 2: Escrever o teste do agregador (RED)**

Criar `tests/lib/pedidos-faturamento.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CustoResolver } from '@/lib/resumo-vendas';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA CETIM',
    codigo: '001', cor: null, ean: '789', quantity: 1, unit_price: 10,
    sale_fee: 0, is_publiai: true, ...over,
  };
}
function venda(over: Partial<Venda> = {}): Venda {
  return {
    id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-06-15T00:00:00Z', date_created: null, comprador_nick: 'cliente',
    comprador_id: 100, total_amount: 10, paid_amount: 10, sale_fee_total: 1,
    frete_vendedor: null, liquido: 9, estorno: null, money_release_date: null,
    currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
    shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over,
  };
}

describe('agruparPorPedido', () => {
  it('agrupa orders do mesmo pack numa linha (frete uma vez, valores somados)', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 50, shipping_id: 99, total_amount: 12.5, liquido: 11, frete_vendedor: 40.4,
        itens: [item({ id: 'i1', titulo: 'A', unit_price: 12.5, quantity: 1 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 50, shipping_id: 99, total_amount: 37.9, liquido: 31.46, frete_vendedor: 40.4,
        itens: [item({ id: 'i2', titulo: 'B', unit_price: 37.9, quantity: 1 })] }),
    ];
    const pedidos = agruparPorPedido(vendas);
    expect(pedidos).toHaveLength(1);
    const p = pedidos[0];
    expect(p.isPack).toBe(true);
    expect(p.orderIds).toEqual([1, 2]);
    expect(p.bruto).toBe(50.4);          // 12.5 + 37.9
    expect(p.frete).toBe(40.4);          // uma vez, não 80.8
    expect(p.liquido).toBe(42.46);       // 11 + 31.46
    expect(p.unidades).toBe(2);
    expect(p.itens).toHaveLength(2);
  });

  it('pedido sem pack vira 1 linha (chave = order_id)', () => {
    const pedidos = agruparPorPedido([venda({ id: 'a', order_id: 7, pack_id: null })]);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].isPack).toBe(false);
    expect(pedidos[0].chave).toBe('7');
  });

  it('markup do pedido e por produto usando custo (rateio do líquido por valor)', () => {
    const custo: CustoResolver = (it) => (it.id === 'i1' ? 5 : 10); // custo unitário
    const vendas = [venda({
      id: 'a', order_id: 1, pack_id: null, total_amount: 30, liquido: 24,
      itens: [
        item({ id: 'i1', titulo: 'A', unit_price: 10, quantity: 1 }),   // valor 10
        item({ id: 'i2', titulo: 'B', unit_price: 20, quantity: 1 }),   // valor 20
      ],
    })];
    const p = agruparPorPedido(vendas, custo)[0];
    expect(p.custo).toBe(15);                 // 5 + 10
    // markup do pedido = (24 - 15)/15 = 0.6
    expect(p.markup).toBeCloseTo(0.6, 5);
    // líquido rateado por valor: i1 = 24*10/30 = 8 ; i2 = 24*20/30 = 16
    const i1 = p.itens.find((x) => x.id === 'i1')!;
    const i2 = p.itens.find((x) => x.id === 'i2')!;
    expect(i1.liquido).toBe(8);
    expect(i2.liquido).toBe(16);
    expect(i1.markup).toBeCloseTo((8 - 5) / 5, 5);   // 0.6
    expect(i2.markup).toBeCloseTo((16 - 10) / 10, 5); // 0.6
  });

  it('sem custo cadastrado → markup null', () => {
    const p = agruparPorPedido([venda({ id: 'a' })])[0];
    expect(p.custo).toBeNull();
    expect(p.markup).toBeNull();
    expect(p.itens[0].markup).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `pnpm test -- tests/lib/pedidos-faturamento.test.ts`
Expected: FAIL — `agruparPorPedido` não existe (módulo `@/lib/pedidos-faturamento` não encontrado).

- [ ] **Step 4: Implementar o agregador (mínimo p/ passar)**

Criar `src/lib/pedidos-faturamento.ts`:

```ts
// Visão por PEDIDO do menu Faturamento (ADR-0039): agrupa os order_id por pack (pack_id ?? order_id)
// numa única linha — um carrinho do cliente vira um pedido, e os produtos vão para o detalhe.
// Reaproveita o rateio de frete (ratearLiquidoPorFrete) e o custo (CustoResolver). Pura e testável.
import type { Venda, VendaItem } from './faturamento';
import { ehFaturavel, ratearLiquidoPorFrete, type CustoResolver, type PesoResolver } from './resumo-vendas';
import { calcularMarkup } from './markup';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ItemPedido {
  id: string;
  ml_item_id: string | null;
  titulo: string | null;
  codigo: string | null;
  cor: string | null;
  ean: string | null;
  quantity: number;
  unit_price: number;
  /** Custo total do item (custo unitário × qtd), em R$. null = sem custo cadastrado. */
  custo: number | null;
  /** Líquido atribuído ao item: rateio do líquido do pedido por valor bruto do item. */
  liquido: number;
  /** (líquido − custo) ÷ custo. null sem custo. */
  markup: number | null;
}

export interface Pedido {
  /** Chave do pedido: String(pack_id ?? order_id). */
  chave: string;
  /** Verdadeiro quando agrupa >1 order_id do mesmo pack. */
  isPack: boolean;
  orderIds: number[];
  data: string | null;
  comprador_id: number | null;
  comprador_nick: string | null;
  /** Status de pagamento representativo do grupo (do membro mais antigo). */
  status: string;
  statusDetail: string | null;
  shipping_status: string | null;
  /** Soma das quantidades dos itens. */
  unidades: number;
  /** Valor do checkout: soma de total_amount dos orders do pedido. */
  bruto: number;
  /** Frete do envio (uma vez por pack). null = sem frete. */
  frete: number | null;
  /** Líquido do pedido: soma do líquido (rateado) dos membros. */
  liquido: number;
  /** Custo total dos produtos do pedido. null = nenhum item com custo. */
  custo: number | null;
  markup: number | null;
  comissao: number;
  rastreio: string | null;
  is_publiai: boolean;
  tem_devolucao: boolean;
  itens: ItemPedido[];
}

/** Custo total (R$) de um item: custo unitário × qtd. null se sem custo. */
function custoDoItem(it: VendaItem, resolver?: CustoResolver): number | null {
  const unit = resolver?.(it) ?? null;
  return unit != null && unit > 0 ? round2(unit * it.quantity) : null;
}

/**
 * Agrupa as vendas (linhas de ml_vendas, 1 por order_id) em PEDIDOS por `pack_id ?? order_id`.
 * Totais por pedido: bruto = Σ total_amount; líquido = Σ líquido rateado; frete = max (uma vez);
 * custo = Σ custo dos itens. Markup do pedido = (líquido − custo) ÷ custo. Por item, o líquido é
 * rateado pelo valor bruto do item e o markup recalculado. Ordena do mais recente ao mais antigo.
 */
export function agruparPorPedido(
  vendas: Venda[], custoResolver?: CustoResolver, pesoResolver?: PesoResolver,
): Pedido[] {
  const rateio = ratearLiquidoPorFrete(vendas, pesoResolver);
  const liquidoMembro = (v: Venda) => rateio.get(v.id)?.liquido ?? v.liquido ?? 0;

  const grupos = new Map<string, Venda[]>();
  for (const v of vendas) {
    const chave = String(v.pack_id ?? v.order_id);
    const g = grupos.get(chave);
    if (g) g.push(v); else grupos.set(chave, [v]);
  }

  const pedidos: Pedido[] = [];
  for (const [chave, membros] of grupos) {
    membros.sort((a, b) => a.order_id - b.order_id);
    const bruto = round2(membros.reduce((s, v) => s + v.total_amount, 0));
    const liquido = round2(membros.reduce((s, v) => s + liquidoMembro(v), 0));
    const freteMax = Math.max(0, ...membros.map((v) => v.frete_vendedor ?? 0));
    const frete = freteMax > 0 ? round2(freteMax) : null;
    const comissao = round2(membros.reduce((s, v) => s + v.sale_fee_total, 0));

    const itensFlat = membros.flatMap((v) => v.itens);
    const unidades = itensFlat.reduce((s, i) => s + i.quantity, 0);
    const valorItens = itensFlat.reduce((s, i) => s + i.unit_price * i.quantity, 0);

    let custoTotal = 0;
    let temCusto = false;
    const itens: ItemPedido[] = itensFlat.map((it) => {
      const custo = custoDoItem(it, custoResolver);
      if (custo != null) { custoTotal += custo; temCusto = true; }
      const valorItem = it.unit_price * it.quantity;
      const liqItem = valorItens > 0 ? round2((liquido * valorItem) / valorItens) : 0;
      const markup = custo != null && custo > 0 ? calcularMarkup(liqItem, custo).markup : null;
      return {
        id: it.id, ml_item_id: it.ml_item_id, titulo: it.titulo, codigo: it.codigo,
        cor: it.cor, ean: it.ean, quantity: it.quantity, unit_price: it.unit_price,
        custo, liquido: liqItem, markup,
      };
    });
    const custo = temCusto ? round2(custoTotal) : null;
    const markup = custo != null && custo > 0 ? calcularMarkup(liquido, custo).markup : null;

    const primeiro = membros[0];
    pedidos.push({
      chave,
      isPack: primeiro.pack_id != null && membros.length > 1,
      orderIds: membros.map((v) => v.order_id),
      data: primeiro.date_closed ?? primeiro.date_created,
      comprador_id: primeiro.comprador_id ?? null,
      comprador_nick: primeiro.comprador_nick,
      status: primeiro.status,
      statusDetail: primeiro.status_detail,
      shipping_status: primeiro.shipping_status,
      unidades, bruto, frete, liquido, custo, markup, comissao,
      rastreio: primeiro.tracking_number,
      is_publiai: membros.some((v) => v.is_publiai),
      tem_devolucao: membros.some((v) => v.tem_devolucao),
      itens,
    });
  }
  pedidos.sort((a, b) => Date.parse(b.data ?? '') - Date.parse(a.data ?? ''));
  return pedidos;
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm test -- tests/lib/pedidos-faturamento.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 6: Commit (somente após OK do Diego)**

```bash
git add src/lib/faturamento.ts src/lib/pedidos-faturamento.ts tests/lib/pedidos-faturamento.test.ts
git commit -m "feat(faturamento): agregador agruparPorPedido (pack) com markup por pedido/produto (ADR-0039)"
```

---

### Task 2: KPIs por pedido (`calcularKpisPedidos`)

**Files:**
- Modify: `src/lib/pedidos-faturamento.ts`
- Test: `tests/lib/pedidos-faturamento.test.ts`

**Interfaces:**
- Consumes: `Pedido` (Task 1), `ehFaturavel` (`@/lib/resumo-vendas`), `labelStatusEnvio` (`@/lib/ml-status`).
- Produces:
  - `interface KpisPedidos { pedidos: number; unidades: number; ticket: number; itensPorPedido: number; markup: number|null; compradoresUnicos: number; pctRecompra: number; porStatusEnvio: Record<string, number> }`
  - `function calcularKpisPedidos(pedidos: Pedido[]): KpisPedidos`

- [ ] **Step 1: Escrever o teste dos KPIs (RED)**

Anexar em `tests/lib/pedidos-faturamento.test.ts` (reusa os helpers `venda`/`item` já definidos no arquivo):

```ts
import { calcularKpisPedidos } from '@/lib/pedidos-faturamento';
import { agruparPorPedido as _agrupar } from '@/lib/pedidos-faturamento';

describe('calcularKpisPedidos', () => {
  it('conta pedidos reais (packs), ticket e itens por pedido sobre faturáveis', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 50, total_amount: 12.5, shipping_status: 'ready_to_ship',
        itens: [item({ id: 'i1', quantity: 1 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 50, total_amount: 37.5, shipping_status: 'ready_to_ship',
        itens: [item({ id: 'i2', quantity: 1 })] }),
      venda({ id: 'c', order_id: 3, pack_id: null, total_amount: 50, shipping_status: 'shipped',
        comprador_id: 200, itens: [item({ id: 'i3', quantity: 2 })] }),
    ];
    const k = calcularKpisPedidos(_agrupar(vendas));
    expect(k.pedidos).toBe(2);             // 1 pack + 1 solo
    expect(k.unidades).toBe(4);            // 1 + 1 + 2
    expect(k.ticket).toBe(50);            // (50 + 50) / 2
    expect(k.itensPorPedido).toBe(2);     // 4 / 2
    expect(k.compradoresUnicos).toBe(2);  // comprador 100 e 200
  });

  it('cancelado fica fora dos KPIs monetários mas conta no status de envio', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: null, total_amount: 50, shipping_status: 'shipped' }),
      venda({ id: 'b', order_id: 2, pack_id: null, status: 'cancelled', total_amount: 999, shipping_status: 'pending' }),
    ];
    const k = calcularKpisPedidos(_agrupar(vendas));
    expect(k.pedidos).toBe(1);
    expect(Object.values(k.porStatusEnvio).reduce((a, b) => a + b, 0)).toBe(2); // conta os 2 pedidos
  });

  it('pctRecompra = % dos pedidos de compradores com mais de 1 pedido no período', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: null, comprador_id: 100 }),
      venda({ id: 'b', order_id: 2, pack_id: null, comprador_id: 100 }),
      venda({ id: 'c', order_id: 3, pack_id: null, comprador_id: 200 }),
    ];
    const k = calcularKpisPedidos(_agrupar(vendas));
    // comprador 100 tem 2 pedidos (recorrente) → 2 de 3 pedidos = 66.7%
    expect(k.pctRecompra).toBeCloseTo((2 / 3) * 100, 1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- tests/lib/pedidos-faturamento.test.ts -t calcularKpisPedidos`
Expected: FAIL — `calcularKpisPedidos` não existe.

- [ ] **Step 3: Implementar `calcularKpisPedidos`**

Adicionar em `src/lib/pedidos-faturamento.ts` (imports no topo: incluir `labelStatusEnvio`):

```ts
import { labelStatusEnvio } from './ml-status';
```

E ao fim do arquivo:

```ts
export interface KpisPedidos {
  /** Nº de pedidos faturáveis (packs contam 1). */
  pedidos: number;
  unidades: number;
  /** Bruto ÷ pedidos. */
  ticket: number;
  /** Unidades ÷ pedidos. */
  itensPorPedido: number;
  /** Markup agregado: (Σ líquido com custo − Σ custo) ÷ Σ custo. null sem custo. */
  markup: number | null;
  compradoresUnicos: number;
  /** % dos pedidos feitos por compradores com >1 pedido no período. */
  pctRecompra: number;
  /** Contagem de pedidos por status de envio (TODOS os pedidos, indep. de pagamento). */
  porStatusEnvio: Record<string, number>;
}

/** Agrega KPIs operacionais a partir dos pedidos. Monetários só sobre faturáveis (ADR-0038). */
export function calcularKpisPedidos(pedidos: Pedido[]): KpisPedidos {
  let bruto = 0, unidades = 0, faturaveis = 0, liqComCusto = 0, custoTotal = 0;
  const porStatusEnvio: Record<string, number> = {};
  const pedidosPorComprador = new Map<number, number>();

  for (const p of pedidos) {
    const st = labelStatusEnvio(p.shipping_status).label;
    porStatusEnvio[st] = (porStatusEnvio[st] ?? 0) + 1;
    if (!ehFaturavel(p.status)) continue;
    faturaveis += 1;
    bruto += p.bruto;
    unidades += p.unidades;
    if (p.custo != null && p.custo > 0) { liqComCusto += p.liquido; custoTotal += p.custo; }
    if (p.comprador_id != null) {
      pedidosPorComprador.set(p.comprador_id, (pedidosPorComprador.get(p.comprador_id) ?? 0) + 1);
    }
  }

  const compradoresUnicos = pedidosPorComprador.size;
  let pedidosRecorrentes = 0;
  for (const n of pedidosPorComprador.values()) if (n > 1) pedidosRecorrentes += n;
  const pctRecompra = faturaveis > 0 ? round2((pedidosRecorrentes / faturaveis) * 100) : 0;

  return {
    pedidos: faturaveis,
    unidades,
    ticket: faturaveis > 0 ? round2(bruto / faturaveis) : 0,
    itensPorPedido: faturaveis > 0 ? round2(unidades / faturaveis) : 0,
    markup: custoTotal > 0 ? (liqComCusto - custoTotal) / custoTotal : null,
    compradoresUnicos,
    pctRecompra,
    porStatusEnvio,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- tests/lib/pedidos-faturamento.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit (após OK do Diego)**

```bash
git add src/lib/pedidos-faturamento.ts tests/lib/pedidos-faturamento.test.ts
git commit -m "feat(faturamento): KPIs por pedido (pedidos reais, itens/pedido, recompra, status)"
```

---

### Task 3: Aba Vendas renderiza pedidos + detalhe com markup + KPIs novos

**Files:**
- Modify: `src/components/faturamento/aba-vendas.tsx`
- Test: `tests/components/aba-vendas-pedido.test.tsx` (create)

**Interfaces:**
- Consumes: `agruparPorPedido`, `calcularKpisPedidos`, `Pedido`, `ItemPedido` (Tasks 1-2); `useVendas`, `useCustos`, `montarCustoResolver`, `montarPesoResolver` (hooks/libs existentes); `fmtBRL`/`fmtInt`, `labelStatusPedido`/`labelStatusEnvio`/`fmtDataCurta`, `StatusPill`, `Table*`.
- Produces: UI; nenhuma exportação nova consumida por outras tasks.

**Contexto de implementação (substituições principais em `aba-vendas.tsx`):**
- Trocar a fonte da tabela: de `vendasOrdenadas` (Venda) para `pedidos` (Pedido) via `agruparPorPedido(vendas, montarCustoResolver(custos), montarPesoResolver(custos))`.
- Trocar os KPIs do topo: usar `calcularKpisPedidos(pedidos)` e os KPIs novos (Pedidos, Unidades, Ticket, Itens/pedido, Markup médio, Compradores únicos + % recompra) — manter o componente `Kpi` (já com `tom`/`valorCor`/hover).
- `LinhaVenda` → `LinhaPedido` (recebe `Pedido`): coluna de **markup** na linha (verde/vermelho, "—" sem custo, reusar `fmtMarkup`), selo "recorrente" no comprador, valor = `p.bruto`. Detalhe expandido lista `p.itens` com colunas Item, Cor, Código, EAN, Qtd, Preço, **Líquido**, **Markup** (por produto). Bloco superior do detalhe: order ids do pacote, frete (uma vez), comissão, rastreio.
- Card "Pedidos por status de envio" passa a usar `kpis.porStatusEnvio` (já vem de `calcularKpisPedidos`), e cada status vira botão que filtra a tabela por aquele status de envio (estado `filtroEnvio`).

- [ ] **Step 1: Escrever o teste de componente (RED)**

Criar `tests/components/aba-vendas-pedido.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

const pack = [
  {
    id: 'a', order_id: 1, pack_id: 50, status: 'paid', status_detail: null,
    date_closed: '2026-06-15T00:00:00Z', date_created: null, comprador_nick: 'cliente', comprador_id: 100,
    total_amount: 12.5, paid_amount: 12.5, sale_fee_total: 1, frete_vendedor: 40.4, liquido: 11,
    estorno: null, money_release_date: null, currency: 'BRL', shipping_id: 99,
    shipping_status: 'ready_to_ship', shipping_substatus: null, shipping_logistic: null,
    tracking_number: null, is_publiai: true, tem_devolucao: false,
    itens: [{ id: 'i1', ml_item_id: 'MLB1', variation_id: null, titulo: 'PRODUTO A', codigo: '001', cor: null, ean: '789', quantity: 1, unit_price: 12.5, sale_fee: 1, is_publiai: true }],
  },
  {
    id: 'b', order_id: 2, pack_id: 50, status: 'paid', status_detail: null,
    date_closed: '2026-06-15T00:00:00Z', date_created: null, comprador_nick: 'cliente', comprador_id: 100,
    total_amount: 37.9, paid_amount: 37.9, sale_fee_total: 2, frete_vendedor: 40.4, liquido: 31.46,
    estorno: null, money_release_date: null, currency: 'BRL', shipping_id: 99,
    shipping_status: 'ready_to_ship', shipping_substatus: null, shipping_logistic: null,
    tracking_number: null, is_publiai: true, tem_devolucao: false,
    itens: [{ id: 'i2', ml_item_id: 'MLB2', variation_id: null, titulo: 'PRODUTO B', codigo: '002', cor: null, ean: '790', quantity: 1, unit_price: 37.9, sale_fee: 2, is_publiai: true }],
  },
];

vi.mock('@/hooks/useVendas', () => ({ useVendas: () => ({ data: pack, isFetching: false, refetch: vi.fn() }) }));
vi.mock('@/hooks/useCustos', () => ({ useCustos: () => ({ data: undefined }) }));

import { AbaVendas } from '@/components/faturamento/aba-vendas';

describe('AbaVendas — por pedido', () => {
  it('mostra UMA linha para o pack e os produtos no detalhe ao expandir', () => {
    render(<AbaVendas />);
    // KPI de pedidos reais = 1 (não 2)
    expect(screen.getByText('1')).toBeInTheDocument();
    // a linha resume o pack; os títulos dos produtos só aparecem no detalhe
    expect(screen.queryByText('PRODUTO A')).not.toBeInTheDocument();
    // expande a primeira linha de pedido
    fireEvent.click(screen.getByText(/cliente/i));
    expect(screen.getByText('PRODUTO A')).toBeInTheDocument();
    expect(screen.getByText('PRODUTO B')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- tests/components/aba-vendas-pedido.test.tsx`
Expected: FAIL — hoje a aba renderiza 2 linhas (por order) e os títulos aparecem fora do detalhe / KPI de pedidos = 2.

- [ ] **Step 3: Implementar a aba por pedido**

Em `src/components/faturamento/aba-vendas.tsx`:

1. **Imports:** trocar `calcularKpis` por `agruparPorPedido, calcularKpisPedidos, type Pedido` de `@/lib/pedidos-faturamento`; manter `useCustos`, `montarPesoResolver` e adicionar `montarCustoResolver` de `@/lib/custos`; manter `ratearLiquidoPorFrete` apenas se ainda usado (não será — remover o import órfão). Adicionar `fmtMarkup` local (igual ao de `DetalheFinanceiro`):

```ts
function fmtMarkup(markup: number): string {
  const p = Math.round(markup * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}
```

2. **Derivação no componente `AbaVendas`** (substituir o bloco `kpis`/`rateio`/`vendasOrdenadas`):

```tsx
  const { data: vendas, isFetching, refetch } = useVendas(janela, origem);
  const { data: custos } = useCustos();
  const pedidos = useMemo(
    () => agruparPorPedido(vendas ?? [], montarCustoResolver(custos), montarPesoResolver(custos)),
    [vendas, custos],
  );
  const kpis = useMemo(() => calcularKpisPedidos(pedidos), [pedidos]);

  const [filtroEnvio, setFiltroEnvio] = useState<string | null>(null);
  const pedidosFiltrados = useMemo(
    () => (filtroEnvio ? pedidos.filter((p) => labelStatusEnvio(p.shipping_status).label === filtroEnvio) : pedidos),
    [pedidos, filtroEnvio],
  );
```

3. **KPIs do topo** (substituir o grid de 4 KPIs):

```tsx
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={DollarSign} label="Faturamento" valor={fmtBRL(kpis.ticket * kpis.pedidos)} tom="success" />
        <Kpi icon={ShoppingBag} label="Pedidos" valor={fmtInt(kpis.pedidos)} tom="info" />
        <Kpi icon={Package} label="Unidades" valor={fmtInt(kpis.unidades)} tom="info" />
        <Kpi icon={Target} label="Ticket médio" valor={fmtBRL(kpis.ticket)} tom="info" />
        <Kpi icon={Layers} label="Itens / pedido" valor={kpis.itensPorPedido.toFixed(1).replace('.', ',')} tom="info" />
        <Kpi icon={Users} label="Compradores" valor={`${fmtInt(kpis.compradoresUnicos)}`} tom="info"
          />
      </div>
```

> Nota: importar `Layers` e `Users` de `lucide-react`. "Faturamento" usa `kpis.ticket * kpis.pedidos` = bruto faturável (evita recalcular). Se preferir bruto exato, adicionar `bruto` ao `KpisPedidos` — opcional, fora do escopo mínimo.

4. **Card de status** (clicável; substituir o conteúdo do card "Pedidos por status de envio"):

```tsx
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {Object.entries(kpis.porStatusEnvio).sort((a, b) => b[1] - a[1]).map(([status, n]) => (
            <button key={status} type="button"
              onClick={() => setFiltroEnvio((f) => (f === status ? null : status))}
              className={cn('rounded-md px-2 py-0.5 tabular-nums transition-colors hover:bg-muted',
                filtroEnvio === status && 'bg-primary/15 text-foreground')}>
              <span className="font-semibold">{n}</span> <span className="text-muted-foreground">{status}</span>
            </button>
          ))}
          {Object.keys(kpis.porStatusEnvio).length === 0 && <span className="text-muted-foreground">—</span>}
        </div>
```

5. **Tabela:** trocar o header para incluir **Markup** e renderizar `LinhaPedido`:

```tsx
          <TableHeader>
            <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
              <TableHead className="w-8" />
              <ThSort k="data" label="Data" sort={sort} onSort={toggleSort} />
              <ThSort k="comprador" label="Comprador" sort={sort} onSort={toggleSort} />
              <ThSort k="unidades" label="Itens" sort={sort} onSort={toggleSort} />
              <ThSort k="valor" label="Valor" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="liquido" label="Líquido" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="markup" label="Markup" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="pagamento" label="Pagamento" sort={sort} onSort={toggleSort} />
              <ThSort k="envio" label="Envio" sort={sort} onSort={toggleSort} />
              <ThSort k="origem" label="Origem" sort={sort} onSort={toggleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pedidosFiltrados.map((p) => <LinhaPedido key={p.chave} p={p} />)}
          </TableBody>
```

6. **Componente `LinhaPedido`** (substitui `LinhaVenda`):

```tsx
function LinhaPedido({ p }: { p: Pedido }) {
  const [aberto, setAberto] = useState(false);
  const pgto = labelStatusPedido(p.status);
  const envio = labelStatusEnvio(p.shipping_status);
  const urlVenda = `https://www.mercadolivre.com.br/vendas/${p.orderIds[0]}/detalhe`;
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setAberto((a) => !a)}>
        <TableCell className="w-8 align-middle">
          {aberto ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="whitespace-nowrap tabular-nums">{fmtDataCurta(p.data)}</TableCell>
        <TableCell className="max-w-[160px] truncate">
          <span className="flex items-center gap-1">
            {p.comprador_nick ?? '—'}
            {p.isPack && <StatusPill tone="neutral">{p.orderIds.length} pedidos</StatusPill>}
          </span>
        </TableCell>
        <TableCell className="tabular-nums">{p.unidades}</TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtBRL(p.bruto)}</TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums text-success">{fmtBRL(p.liquido)}</TableCell>
        <TableCell className={cn('text-right tabular-nums', p.markup == null ? 'text-muted-foreground' : p.markup >= 0 ? 'text-success' : 'text-destructive')}>
          {p.markup == null ? '—' : fmtMarkup(p.markup)}
        </TableCell>
        <TableCell><StatusPill tone={tom(pgto.tom)}>{pgto.label}</StatusPill></TableCell>
        <TableCell><StatusPill tone={tom(envio.tom)}>{envio.label}</StatusPill></TableCell>
        <TableCell>
          <span className="flex items-center gap-1">
            <StatusPill tone={p.is_publiai ? 'info' : 'neutral'}>{p.is_publiai ? 'PubliAI' : 'Fora'}</StatusPill>
            {p.tem_devolucao && <StatusPill tone="danger"><RotateCcw className="h-3 w-3" />Devolução</StatusPill>}
          </span>
        </TableCell>
      </TableRow>
      {aberto && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={10} className="p-0">
            <div className="px-10 py-3">
              <div className="mb-2 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                <div>Pedido(s) <span className="font-medium text-foreground tabular-nums">{p.orderIds.join(', ')}</span></div>
                <div>Comissão ML <span className="font-medium text-foreground tabular-nums">{fmtBRL(p.comissao)}</span></div>
                <div>Frete vendedor <span className="font-medium text-foreground tabular-nums">{p.frete != null ? fmtBRL(p.frete) : '—'}</span></div>
                <div>Rastreio <span className="font-medium text-foreground">{p.rastreio ?? '—'}</span></div>
              </div>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>EAN</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Preço un.</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead className="text-right">Markup</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.itens.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="max-w-[280px] truncate uppercase" title={i.titulo ?? ''}>{i.titulo ?? '—'}</TableCell>
                      <TableCell>{i.cor ?? '—'}</TableCell>
                      <TableCell className="tabular-nums">{i.codigo ?? '—'}</TableCell>
                      <TableCell className="tabular-nums">{i.ean ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBRL(i.unit_price)}</TableCell>
                      <TableCell className="text-right tabular-nums text-success">{fmtBRL(i.liquido)}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', i.markup == null ? 'text-muted-foreground' : i.markup >= 0 ? 'text-success' : 'text-destructive')}>
                        {i.markup == null ? '—' : fmtMarkup(i.markup)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-2">
                <a href={urlVenda} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-info hover:underline">
                  Ver no Mercado Livre <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
```

7. **Ordenação:** ajustar `valorOrdenacao` para receber `Pedido` e a `SortKey` ganhar `'markup'`; mapear: `data`→`Date.parse(p.data)`, `comprador`→`p.comprador_nick`, `unidades`→`p.unidades`, `valor`→`p.bruto`, `liquido`→`p.liquido`, `markup`→`p.markup`, `pagamento`/`envio` por label, `origem`→`p.is_publiai?1:0`. Aplicar a ordenação sobre `pedidosFiltrados`.

> Remover o `LinhaVenda` antigo, o `import { calcularKpis }` e o `import { ratearLiquidoPorFrete }` que ficarem órfãos.

- [ ] **Step 4: Rodar o teste de componente e ver passar**

Run: `pnpm test -- tests/components/aba-vendas-pedido.test.tsx`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira + build + lint**

Run: `pnpm test` → Expected: todos passam (incl. os existentes de faturamento).
Run: `pnpm build` → Expected: exit 0.
Run: `pnpm lint` → Expected: sem erros novos nos arquivos tocados (`pedidos-faturamento.ts`, `aba-vendas.tsx`).

- [ ] **Step 6: Commit (após OK do Diego)**

```bash
git add src/components/faturamento/aba-vendas.tsx tests/components/aba-vendas-pedido.test.tsx
git commit -m "feat(faturamento): aba Vendas por pedido (pack) com markup por pedido/produto + KPIs novos (ADR-0039)"
```

---

## Self-Review

**1. Spec coverage (ADR-0039 §2 e §3):**
- Linha por pedido (`pack_id ?? order_id`) → Task 1 (`agruparPorPedido`) + Task 3 (UI). ✓
- Produto no detalhe → Task 3 (`LinhaPedido` expand). ✓
- Markup líquido por pedido e por produto → Task 1 (`Pedido.markup`, `ItemPedido.markup`) + Task 3 (colunas). ✓
- KPIs novos (itens/pedido, markup médio, compradores únicos, % recompra) → Task 2 + Task 3. ✓
- Contadores de status clicáveis → Task 3 (filtroEnvio). ✓
- Selo "recorrente" → derivável de `comprador_id`; exibição do selo "N pedidos" do pack feita; o selo "cliente recorrente" por comprador pode ser adicionado no KPI/coluna — **coberto parcialmente** (KPI % recompra entrega o sinal agregado; o selo por linha pode entrar como melhoria menor dentro do Task 3 se desejado).
- Geografia (UF) → **Fase 2**, fora deste plano (ADR-0039 §4). ✓ (intencional)

**2. Placeholder scan:** sem TBD/TODO; todo passo de código tem o código real.

**3. Type consistency:** `Pedido`/`ItemPedido`/`KpisPedidos` usados no Task 3 batem com os definidos nas Tasks 1-2; `agruparPorPedido(vendas, custoResolver?, pesoResolver?)` e `calcularKpisPedidos(pedidos)` consistentes entre tasks e teste de componente.

**Observação de risco:** o teste de componente do Task 3 (`getByText('1')`) assume que o KPI "Pedidos" exibe "1"; se algum outro KPI exibir "1" simultaneamente, refinar o seletor (ex.: `getByText('Pedidos').closest(...)`). Ajustar no Step 4 se o teste pegar o elemento errado.
