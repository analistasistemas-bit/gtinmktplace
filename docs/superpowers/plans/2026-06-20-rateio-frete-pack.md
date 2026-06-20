# Rateio de frete em pedido pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Redistribuir, por peso, o frete de um envio compartilhado (pack) entre as linhas do "Detalhe do líquido", corrigindo o markup por produto sem alterar os totais do período.

**Architecture:** O frete já existente é zero-soma redistribuído entre os pagamentos que compartilham um `shipping_id`. MP segue como fonte dos totais; um passo puro pós-agregação reatribui `liquido`/`retido` das linhas de cada grupo (>1 membro).

**Tech Stack:** Deno edge functions (TS), vitest (`pnpm test`), Supabase, React/TS frontend.

## Global Constraints

- Totais do período (bruto/líquido/descontos/estornos) **não podem mudar** — o rateio é zero-soma por grupo (ADR-0031).
- Pedido de envio único (grupo de 1) = **saída idêntica** à atual (regressão).
- `Σ liquido_i'` por grupo == `Σ liquido_i` original em centavos (ajuste de resíduo na linha de maior peso).
- Não chamar API extra de frete: `frete_grupo = Σ(bruto−liquido) − Σ tarifa`.
- Testes vitest em `__tests__/`, import relativo (`../modulo`), `describe/it/expect`.

---

### Task 1: Módulo puro `ratearFreteCompartilhado`

**Files:**
- Create: `supabase/functions/_shared/mercadopago/rateio.ts`
- Test: `supabase/functions/_shared/mercadopago/__tests__/rateio.test.ts`

**Interfaces:**
- Consumes: `VendaFinanceira` (de `./financeiro.ts`) e um mapa `Record<string, InfoRateio>` onde `InfoRateio = { tarifa?: number; peso?: number; shippingId?: string | null }`.
- Produces: `ratearFreteCompartilhado(vendas: VendaFinanceira[], info: Record<string, InfoRateio>): VendaFinanceira[]` — novo array; só `liquido`/`retido` de grupos com >1 membro mudam.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ratearFreteCompartilhado, type InfoRateio } from '../rateio';
import type { VendaFinanceira } from '../financeiro';

function venda(v: Partial<VendaFinanceira> & { id: string }): VendaFinanceira {
  return { data: null, descricao: null, bruto: 0, liquido: 0, retido: 0,
    estorno: 0, custo: null, codigo: null, ...v } as VendaFinanceira;
}

describe('ratearFreteCompartilhado', () => {
  it('redistribui o frete por peso entre as linhas do mesmo envio (zero-soma)', () => {
    // Pack real: Linha (frete todo nela) + Fita. Σ líquido = 35,00.
    const vendas = [
      venda({ id: 'L', bruto: 45.10, liquido: 24.46, retido: 20.64 }),
      venda({ id: 'F', bruto: 12.70, liquido: 10.54, retido: 2.16 }),
    ];
    const info: Record<string, InfoRateio> = {
      L: { tarifa: 7.44, peso: 338, shippingId: 'S1' },
      F: { tarifa: 2.16, peso: 58, shippingId: 'S1' },
    };
    const r = ratearFreteCompartilhado(vendas, info);
    const byId = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(byId.L.liquido).toBe(26.39);
    expect(byId.L.retido).toBe(18.71);
    expect(byId.F.liquido).toBe(8.61);
    expect(byId.F.retido).toBe(4.09);
    expect(byId.L.liquido + byId.F.liquido).toBeCloseTo(35.00, 2);
  });

  it('não altera grupo de um envio só (regressão)', () => {
    const vendas = [venda({ id: 'A', bruto: 45.10, liquido: 24.46, retido: 20.64 })];
    const info = { A: { tarifa: 7.44, peso: 338, shippingId: 'S9' } };
    expect(ratearFreteCompartilhado(vendas, info)).toEqual(vendas);
  });

  it('mantém o grupo cru quando falta peso/tarifa/shippingId de algum membro', () => {
    const vendas = [
      venda({ id: 'L', bruto: 45.10, liquido: 24.46, retido: 20.64 }),
      venda({ id: 'F', bruto: 12.70, liquido: 10.54, retido: 2.16 }),
    ];
    const info = { L: { tarifa: 7.44, peso: 338, shippingId: 'S1' }, F: { shippingId: 'S1' } };
    expect(ratearFreteCompartilhado(vendas, info)).toEqual(vendas);
  });

  it('peso_grupo=0 → rateia por valor (bruto)', () => {
    const vendas = [
      venda({ id: 'L', bruto: 30, liquido: 15, retido: 15 }),
      venda({ id: 'F', bruto: 10, liquido: 9, retido: 1 }),
    ];
    const info = { L: { tarifa: 5, peso: 0, shippingId: 'S1' }, F: { tarifa: 1, peso: 0, shippingId: 'S1' } };
    const r = ratearFreteCompartilhado(vendas, info);
    // frete_grupo = (15+1) - (5+1) = 10; por valor: L 30/40=7,5; F 10/40=2,5
    const byId = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(byId.L.liquido).toBe(17.5); // 30 - 5 - 7,5
    expect(byId.F.liquido).toBe(6.5);  // 10 - 1 - 2,5
    expect(byId.L.liquido + byId.F.liquido).toBe(24); // soma preservada
  });

  it('frete_grupo<0 → mantém cru', () => {
    const vendas = [
      venda({ id: 'L', bruto: 30, liquido: 28, retido: 2 }),
      venda({ id: 'F', bruto: 10, liquido: 9, retido: 1 }),
    ];
    const info = { L: { tarifa: 5, peso: 1, shippingId: 'S1' }, F: { tarifa: 5, peso: 1, shippingId: 'S1' } };
    expect(ratearFreteCompartilhado(vendas, info)).toEqual(vendas);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm test -- rateio` → "Cannot find module '../rateio'".

- [ ] **Step 3: Implement**

```ts
// Rateio do frete de envio compartilhado (pack) por peso, entre as linhas do mesmo
// shipping_id. Zero-soma: a soma dos líquidos do grupo não muda — só a atribuição do
// frete entre as linhas. Pura. Ver spec 2026-06-20-rateio-frete-pack.
import type { VendaFinanceira } from './financeiro.ts';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface InfoRateio {
  tarifa?: number;
  peso?: number;
  shippingId?: string | null;
}

export function ratearFreteCompartilhado(
  vendas: VendaFinanceira[],
  info: Record<string, InfoRateio>,
): VendaFinanceira[] {
  // Agrupa por shippingId (só quem tem id de envio).
  const grupos = new Map<string, VendaFinanceira[]>();
  for (const v of vendas) {
    const sid = info[v.id]?.shippingId;
    if (!sid) continue;
    (grupos.get(sid) ?? grupos.set(sid, []).get(sid)!).push(v);
  }

  const ajustada = new Map<string, VendaFinanceira>();
  for (const membros of grupos.values()) {
    if (membros.length < 2) continue;
    // Defensivo: todo membro precisa de tarifa e peso numéricos.
    if (membros.some((m) => typeof info[m.id]?.tarifa !== 'number' || typeof info[m.id]?.peso !== 'number')) continue;

    const retidoGrupo = membros.reduce((s, m) => s + (m.bruto - m.liquido), 0);
    const tarifaGrupo = membros.reduce((s, m) => s + (info[m.id]!.tarifa as number), 0);
    const freteGrupo = round2(retidoGrupo - tarifaGrupo);
    if (freteGrupo < 0) continue;

    const pesoGrupo = membros.reduce((s, m) => s + (info[m.id]!.peso as number), 0);
    const brutoGrupo = membros.reduce((s, m) => s + m.bruto, 0);
    const base = pesoGrupo > 0
      ? membros.map((m) => info[m.id]!.peso as number)
      : membros.map((m) => m.bruto);
    const baseTotal = pesoGrupo > 0 ? pesoGrupo : brutoGrupo;
    if (baseTotal <= 0) continue;

    // Rateia o frete; ajusta o resíduo de centavos na linha de maior base.
    const fretes = base.map((b) => round2((freteGrupo * b) / baseTotal));
    const resto = round2(freteGrupo - fretes.reduce((s, f) => s + f, 0));
    let idxMax = 0;
    for (let i = 1; i < base.length; i++) if (base[i] > base[idxMax]) idxMax = i;
    fretes[idxMax] = round2(fretes[idxMax] + resto);

    membros.forEach((m, i) => {
      const liquido = round2(m.bruto - (info[m.id]!.tarifa as number) - fretes[i]);
      ajustada.set(m.id, { ...m, liquido, retido: round2(m.bruto - liquido) });
    });
  }

  return vendas.map((v) => ajustada.get(v.id) ?? v);
}
```

- [ ] **Step 4: Run, expect PASS** — `pnpm test -- rateio`.
- [ ] **Step 5: Commit** — `feat(financeiro): rateio de frete por peso em envio compartilhado`.

---

### Task 2: `pedidos.ts` expõe tarifa e shipping_id

**Files:**
- Modify: `supabase/functions/_shared/ml/pedidos.ts`
- Test: `supabase/functions/_shared/ml/__tests__/pedidos.test.ts`

**Interfaces:**
- Produces: `ItemDoPagamento` ganha `tarifaItem: number` e `shippingId: string | null`. `PedidoComPagamentos.order_items[]` aceita `unit_price?`, `sale_fee?`; `PedidoComPagamentos.shipping?: { id?: number|string|null }`.

- [ ] **Step 1: Failing test** (anexar ao describe existente)

```ts
it('captura tarifa (sale_fee somada) e shipping_id do pedido', () => {
  const r = mapearPagamentoParaItem([
    { id: 9, shipping: { id: 555 },
      order_items: [{ item: { id: 'MLB9', variation_id: 3 }, quantity: 1, sale_fee: 2.16 }],
      payments: [{ id: 900 }] },
  ]);
  expect(r['900']).toEqual({ mlItemId: 'MLB9', mlVariationId: '3', quantidade: 1, tarifaItem: 2.16, shippingId: '555' });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm test -- pedidos`.

- [ ] **Step 3: Implement** — em `pedidos.ts`:
  - Na interface `PedidoComPagamentos`: `order_items?: Array<{ item?...; quantity?: number|null; sale_fee?: number|null }>` e `shipping?: { id?: number|string|null } | null`.
  - Em `ItemDoPagamento`: `+ tarifaItem: number; shippingId: string | null;`.
  - No loop: somar `tarifa += Number(oi?.sale_fee ?? 0)`; após o `for`, `const shippingId = pedido.shipping?.id != null ? String(pedido.shipping.id) : null;` e incluir `tarifaItem: round2(tarifa)`, `shippingId` no objeto gravado em `out[String(pid)]`. (Adicionar `const round2 = (n)=>Math.round(n*100)/100;` no topo.)

- [ ] **Step 4: Run, expect PASS** — `pnpm test -- pedidos`. (Os testes antigos esperam `toEqual` sem os campos novos → **atualizar** os `toEqual` existentes para incluir `tarifaItem` e `shippingId: null` onde não havia shipping.)
- [ ] **Step 5: Commit** — `feat(ml): pedidos expõem tarifa e shipping_id p/ rateio`.

---

### Task 3: `financeiro.ts` carrega peso/tarifa/shippingId e aplica rateio

**Files:**
- Modify: `supabase/functions/_shared/mercadopago/financeiro.ts`
- Test: `supabase/functions/_shared/mercadopago/__tests__/financeiro.test.ts`

**Interfaces:**
- `InfoCusto` ganha campos opcionais: `peso?: number; tarifa?: number; shippingId?: string | null`.
- `agregarFinanceiro` aplica `ratearFreteCompartilhado(vendas, infoPorPagamento)` antes de ordenar/retornar.

- [ ] **Step 1: Failing test**

```ts
it('rateia o frete por peso quando duas vendas compartilham shipping_id', () => {
  const pagamentos = [
    pag({ id: 10, collector_id: CONTA, date_approved: '2026-06-15T10:00:00.000Z',
      transaction_amount: 45.10, transaction_details: { net_received_amount: 24.46 } }),
    pag({ id: 11, collector_id: CONTA, date_approved: '2026-06-15T10:00:00.000Z',
      transaction_amount: 12.70, transaction_details: { net_received_amount: 10.54 } }),
  ];
  const info = {
    '10': { custo: 21.16, codigo: '02543842', tarifa: 7.44, peso: 338, shippingId: 'S1' },
    '11': { custo: 1.95, codigo: 'FITA', tarifa: 2.16, peso: 58, shippingId: 'S1' },
  };
  const r = agregarFinanceiro(pagamentos, INTERVALO, info);
  const byId = Object.fromEntries(r.vendas.map((v) => [v.id, v]));
  expect(byId['10'].liquido).toBe(26.39);
  expect(byId['11'].liquido).toBe(8.61);
  // total do período inalterado (zero-soma):
  expect(r.liquido).toBe(35.00);
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm test -- financeiro`.

- [ ] **Step 3: Implement**
  - `import { ratearFreteCompartilhado } from './rateio.ts';`
  - Em `InfoCusto`: adicionar `peso?: number; tarifa?: number; shippingId?: string | null;`.
  - No fim de `agregarFinanceiro`, antes do `vendas.sort(...)`: `const vendasRateadas = ratearFreteCompartilhado(vendas, infoPorPagamento);` e usar `vendasRateadas` no sort/retorno. KPIs (`bruto`,`liq`,`descontos`) seguem dos acumuladores — inalterados.

- [ ] **Step 4: Run, expect PASS** — `pnpm test -- financeiro` (e suíte toda: `pnpm test`).
- [ ] **Step 5: Commit** — `feat(financeiro): aplica rateio de frete na agregação`.

---

### Task 4: Wire `resumo-financeiro/index.ts`

**Files:**
- Modify: `supabase/functions/resumo-financeiro/index.ts`

**Interfaces:**
- Consumes: `ItemDoPagamento.{tarifaItem, shippingId}` (Task 2) e `InfoCusto.{peso,tarifa,shippingId}` (Task 3).

- [ ] **Step 1:** No `select` de `variacoes`, adicionar `peso_gramas`. Montar `porVariacao`/`porItem` carregando também `peso` (Number de `peso_gramas`).
- [ ] **Step 2:** Em `montarInfoPorPagamento` (em `financeiro.ts`), propagar para cada pagamento: `tarifa = item.tarifaItem`, `shippingId = item.shillingId`, e `peso` da info da variação/item. (Estender a assinatura para receber o `peso` por variação/item e a tarifa/shipping do `itemPorPagamento`.)
- [ ] **Step 3:** `pnpm test` (garante nada quebrou) + `pnpm build`.
- [ ] **Step 4: Commit** — `feat(resumo-financeiro): peso/tarifa/shipping no enriquecimento`.

> Nota: detalhe fino de assinatura de `montarInfoPorPagamento` resolvido na implementação; manter a função pura e coberta pelos testes existentes (que passam `{custo,codigo}` e seguem válidos com campos novos opcionais).

---

### Task 5: Nota de rodapé no frontend

**Files:**
- Modify: `src/pages/DetalheFinanceiro.tsx`

- [ ] **Step 1:** No `<p>` de rodapé, após a frase do "Retido", acrescentar: "Em pedidos com vários produtos (mesmo envio), o frete é rateado entre os itens por peso."
- [ ] **Step 2:** `pnpm build`.
- [ ] **Step 3: Commit** — `feat(financeiro-ui): nota de rateio de frete por peso`.

---

## Self-Review

- **Cobertura do spec:** fórmula (T1), fontes ML tarifa/shipping (T2), peso/wiring (T3/T4), zero-soma e regressão (T1/T3 testes), UI (T5). ✔
- **Placeholders:** nenhum — código completo em cada passo. (T4 tem 1 nota de detalhe de assinatura, resolvida na implementação, coberta por testes.)
- **Consistência de tipos:** `InfoRateio` (T1) é um subconjunto de `InfoCusto` estendido (T3) — `ratearFreteCompartilhado` lê só `tarifa/peso/shippingId`, então aceita `InfoCusto`. `ItemDoPagamento.shippingId` (T2) alimenta `InfoCusto.shippingId` (T3/T4). ✔
