# Financeiro Impecável — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o menu Financeiro o lugar único e completo do dinheiro das vendas — caixa (liberado/a liberar), lucro+margem, breakdown de taxas, evolução temporal, comparativo de período, período personalizado, export CSV e notificação Telegram de liberação.

**Architecture:** KPIs derivados client-side de `ml_vendas` (fonte única, ADR-0038) estendendo o agregador puro `src/lib/resumo-vendas.ts` (TDD). UI nas telas existentes `Financeiro.tsx` e `DetalheFinanceiro.tsx` (sem abas). Notificação é 1 edge isolada (`notificar-liberacao`) agendada por QStash, reusando a infra de Telegram. Única mudança de schema: 1 coluna de idempotência.

**Tech Stack:** React 18 + TS + Vite, TanStack Query, shadcn/ui, recharts ^3.8.1 (já instalado, 1º uso), vitest; Supabase Edge (Deno) + QStash + Telegram Bot API.

## Global Constraints

- **Fonte única `ml_vendas`** — KPIs nunca leem MP/ML ao vivo no caminho do usuário (ADR-0038).
- **Sem "A receber" do MP** — a faixa de Caixa é "liberação dos recebimentos destas vendas", nunca rotulada como saldo a receber (ADR-0031: soma por `money_release_date` diverge do app).
- **Edge chamada por QStash usa `verify_jwt = false`** (ref. incidente workers QStash).
- **Idempotência inegociável** em worker/edge (CLAUDE.md).
- **Valores em R$** via `fmtBRL` de `src/lib/formato.ts`; inteiros via `fmtInt`.
- **Money helper:** arredondar a 2 casas com `Math.round(n*100)/100` (padrão do agregador).
- **TDD:** função pura → teste falha → implementação mínima → teste passa → commit.
- **Não tocar** lifecycle de publicação nem o menu Faturamento.
- Testes de lib em `src/lib/__tests__/*.test.ts`; rodar com `pnpm test`.

---

### Task 1: Estender o agregador `calcularResumo` com caixa, taxas, cobertura e margem

**Files:**
- Modify: `src/lib/resumo-vendas.ts` (interface `ResumoVendas` + corpo de `calcularResumo`)
- Create: `src/lib/__tests__/resumo-vendas.test.ts`

**Interfaces:**
- Consumes: `Venda` (de `src/lib/faturamento.ts`) com campos `total_amount`, `liquido`, `sale_fee_total`, `frete_vendedor`, `money_release_date`, `status`, `itens`; `ehFaturavel(status)`.
- Produces: `ResumoVendas` ganha os campos:
  - `liberado: number` — Σ líquido das vendas faturáveis com `money_release_date` no passado (≤ `agoraMs`).
  - `aLiberar: number` — Σ líquido das faturáveis com `money_release_date` no futuro (> `agoraMs`).
  - `proximaLiberacao: string | null` — menor `money_release_date` futuro (ISO), ou null.
  - `comissao: number` — Σ `sale_fee_total` das faturáveis.
  - `frete: number` — Σ `frete_vendedor` das faturáveis.
  - `vendasComCusto: number` — nº de vendas faturáveis com custo > 0.
  - `totalVendas: number` — alias de `pedidos` (nº faturáveis) para a nota de cobertura.
  - `margem: number | null` — `lucro ÷ liquidoComCusto` (mesma base do markup), null se sem custo.
  - `calcularResumo` ganha 4º parâmetro opcional `agoraMs: number = Date.now()` (injeção p/ teste determinístico).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/resumo-vendas.test.ts
import { describe, it, expect } from 'vitest';
import { calcularResumo } from '../resumo-vendas';
import type { Venda, VendaItem } from '../faturamento';

const item = (over: Partial<VendaItem> = {}): VendaItem => ({
  id: 'i1', ml_item_id: 'MLB1', variation_id: null, titulo: 'Fita', codigo: '001',
  cor: null, ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over,
});
const venda = (over: Partial<Venda> = {}): Venda => ({
  id: over.id ?? 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-10T12:00:00Z', date_created: '2026-06-10T12:00:00Z',
  comprador_nick: null, comprador_id: null, uf: null, cidade: null,
  total_amount: 100, paid_amount: null, sale_fee_total: 12, frete_vendedor: 8, liquido: 80,
  estorno: null, money_release_date: null, currency: 'BRL', shipping_id: null,
  shipping_status: null, shipping_substatus: null, shipping_logistic: null, tracking_number: null,
  is_publiai: true, tem_devolucao: false, itens: [item()], ...over,
});

const AGORA = Date.parse('2026-06-15T00:00:00Z');

describe('calcularResumo — caixa/taxas/cobertura/margem', () => {
  it('separa líquido liberado (passado) de a liberar (futuro) e acha a próxima liberação', () => {
    const vendas = [
      venda({ id: 'a', liquido: 80, money_release_date: '2026-06-12T00:00:00Z' }), // liberado
      venda({ id: 'b', liquido: 50, money_release_date: '2026-06-20T00:00:00Z' }), // a liberar
      venda({ id: 'c', liquido: 30, money_release_date: '2026-06-18T00:00:00Z' }), // a liberar (próxima)
    ];
    const r = calcularResumo(vendas, undefined, undefined, AGORA);
    expect(r.liberado).toBe(80);
    expect(r.aLiberar).toBe(80);
    expect(r.proximaLiberacao).toBe('2026-06-18T00:00:00Z');
  });

  it('soma comissão e frete só das faturáveis', () => {
    const vendas = [
      venda({ id: 'a', sale_fee_total: 12, frete_vendedor: 8 }),
      venda({ id: 'b', status: 'cancelled', sale_fee_total: 99, frete_vendedor: 99 }),
    ];
    const r = calcularResumo(vendas, undefined, undefined, AGORA);
    expect(r.comissao).toBe(12);
    expect(r.frete).toBe(8);
  });

  it('expõe cobertura de custo e margem (lucro ÷ líquido com custo)', () => {
    const resolver = (it: VendaItem) => (it.codigo === '001' ? 40 : null); // custo unit R$40
    const vendas = [
      venda({ id: 'a', liquido: 80, itens: [item({ codigo: '001', quantity: 1 })] }), // custo 40
      venda({ id: 'b', liquido: 50, itens: [item({ codigo: '999', quantity: 1 })] }), // sem custo
    ];
    const r = calcularResumo(vendas, resolver, undefined, AGORA);
    expect(r.totalVendas).toBe(2);
    expect(r.vendasComCusto).toBe(1);
    // lucro = 80 - 40 = 40 ; margem = 40 / 80 = 0.5
    expect(r.lucro).toBe(40);
    expect(r.margem).toBe(0.5);
  });

  it('margem null quando nenhuma venda tem custo', () => {
    const r = calcularResumo([venda()], undefined, undefined, AGORA);
    expect(r.margem).toBeNull();
    expect(r.vendasComCusto).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- resumo-vendas`
Expected: FAIL — `r.liberado` is undefined / `margem` não existe.

- [ ] **Step 3: Add fields to the `ResumoVendas` interface**

Em `src/lib/resumo-vendas.ts`, dentro de `export interface ResumoVendas { ... }`, adicione após `lucro`:

```ts
  /** Σ líquido das vendas já liberadas (money_release_date no passado). */
  liberado: number;
  /** Σ líquido das vendas ainda a liberar (money_release_date no futuro). */
  aLiberar: number;
  /** Menor money_release_date futuro (ISO), ou null se nada a liberar. */
  proximaLiberacao: string | null;
  /** Σ comissão do ML (sale_fee_total) das faturáveis. */
  comissao: number;
  /** Σ frete do vendedor (frete_vendedor) das faturáveis. */
  frete: number;
  /** Nº de vendas faturáveis com custo cadastrado (base do lucro/markup/margem). */
  vendasComCusto: number;
  /** Nº de vendas faturáveis no período (= pedidos), para a nota de cobertura. */
  totalVendas: number;
  /** Margem sobre a receita líquida: lucro ÷ líquido (com custo). null = sem custo. */
  margem: number | null;
```

- [ ] **Step 4: Implement the aggregation in `calcularResumo`**

Altere a assinatura para receber `agoraMs`:

```ts
export function calcularResumo(
  vendas: Venda[], custoResolver?: CustoResolver, pesoResolver?: PesoResolver,
  agoraMs: number = Date.now(),
): ResumoVendas {
```

Declare os acumuladores junto dos existentes (após `let liqComCusto = 0, custoTotal = 0;`):

```ts
  let liberado = 0, aLiberar = 0, comissao = 0, frete = 0, vendasComCusto = 0;
  let proximaLiberacaoMs: number | null = null;
  let proximaLiberacao: string | null = null;
```

Dentro do `for (const v of vendas)`, depois do bloco `const custo = custoDaVenda(...)`, adicione:

```ts
    comissao += v.sale_fee_total ?? 0;
    frete += v.frete_vendedor ?? 0;
    if (custo != null && custo > 0) vendasComCusto += 1;
    if (v.money_release_date) {
      const ms = Date.parse(v.money_release_date);
      if (ms <= agoraMs) {
        liberado += liq;
      } else {
        aLiberar += liq;
        if (proximaLiberacaoMs == null || ms < proximaLiberacaoMs) {
          proximaLiberacaoMs = ms;
          proximaLiberacao = v.money_release_date;
        }
      }
    }
```

No `return`, adicione os campos (após `lucro: ...`):

```ts
    liberado: round2(liberado),
    aLiberar: round2(aLiberar),
    proximaLiberacao,
    comissao: round2(comissao),
    frete: round2(frete),
    vendasComCusto,
    totalVendas: pedidos,
    margem: custoTotal > 0 ? (liqComCusto - custoTotal) / liqComCusto : null,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- resumo-vendas`
Expected: PASS (4 testes).

- [ ] **Step 6: Run the full suite (nada quebrou nos consumidores)**

Run: `pnpm test`
Expected: PASS — verde. Se algum consumidor de `ResumoVendas` reclamar de campo faltante, é só em mocks de teste; complete os mocks com os novos campos (valores 0/null).

- [ ] **Step 7: Commit**

```bash
git add src/lib/resumo-vendas.ts src/lib/__tests__/resumo-vendas.test.ts
git commit -m "feat(financeiro): caixa/comissão/frete/cobertura/margem no agregador"
```

---

### Task 2: Série temporal para o gráfico de evolução

**Files:**
- Modify: `src/lib/resumo-vendas.ts` (nova função exportada)
- Modify: `src/lib/__tests__/resumo-vendas.test.ts` (novo describe)

**Interfaces:**
- Consumes: `Venda[]`, `ehFaturavel`.
- Produces: `agruparPorPeriodo(vendas: Venda[], passo: 'dia' | 'semana'): PontoSerie[]` onde
  `interface PontoSerie { chave: string; rotulo: string; bruto: number; liquido: number }`.
  `chave` = `YYYY-MM-DD` (dia) ou `YYYY-Www` (semana ISO simplificada: domingo-âncora). `rotulo` = `DD/MM`. Ordenado crescente por `chave`. Só vendas faturáveis; usa `date_closed ?? date_created`.

- [ ] **Step 1: Write the failing test**

```ts
// adicionar ao final de src/lib/__tests__/resumo-vendas.test.ts
import { agruparPorPeriodo } from '../resumo-vendas';

describe('agruparPorPeriodo', () => {
  it('agrupa líquido e bruto por dia, ordenado, só faturáveis', () => {
    const vendas = [
      venda({ id: 'a', date_closed: '2026-06-10T09:00:00Z', total_amount: 100, liquido: 80 }),
      venda({ id: 'b', date_closed: '2026-06-10T18:00:00Z', total_amount: 50, liquido: 40 }),
      venda({ id: 'c', date_closed: '2026-06-11T10:00:00Z', total_amount: 30, liquido: 25 }),
      venda({ id: 'x', status: 'cancelled', date_closed: '2026-06-10T10:00:00Z', total_amount: 999, liquido: 999 }),
    ];
    const serie = agruparPorPeriodo(vendas, 'dia');
    expect(serie).toHaveLength(2);
    expect(serie[0]).toMatchObject({ chave: '2026-06-10', rotulo: '10/06', bruto: 150, liquido: 120 });
    expect(serie[1]).toMatchObject({ chave: '2026-06-11', liquido: 25 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- resumo-vendas`
Expected: FAIL — `agruparPorPeriodo` is not a function.

- [ ] **Step 3: Implement**

Em `src/lib/resumo-vendas.ts` adicione no final:

```ts
export interface PontoSerie { chave: string; rotulo: string; bruto: number; liquido: number }

/** Série temporal (bruto/líquido) das vendas faturáveis, agrupada por dia ou semana. Usa UTC para
 *  a chave ser estável; o rótulo é DD/MM. Ordenada crescente. */
export function agruparPorPeriodo(vendas: Venda[], passo: 'dia' | 'semana'): PontoSerie[] {
  const mapa = new Map<string, { rotulo: string; bruto: number; liquido: number }>();
  for (const v of vendas) {
    if (!ehFaturavel(v.status)) continue;
    const iso = v.date_closed ?? v.date_created;
    if (!iso) continue;
    const d = new Date(iso);
    if (passo === 'semana') d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // âncora no domingo
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const chave = `${yyyy}-${mm}-${dd}`;
    const rotulo = `${dd}/${mm}`;
    const acc = mapa.get(chave) ?? { rotulo, bruto: 0, liquido: 0 };
    acc.bruto += v.total_amount;
    acc.liquido += v.liquido ?? 0;
    mapa.set(chave, acc);
  }
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([chave, a]) => ({ chave, rotulo: a.rotulo, bruto: round2(a.bruto), liquido: round2(a.liquido) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- resumo-vendas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/resumo-vendas.ts src/lib/__tests__/resumo-vendas.test.ts
git commit -m "feat(financeiro): série temporal agruparPorPeriodo p/ o gráfico"
```

---

### Task 3: Período personalizado na tela principal

**Files:**
- Modify: `src/pages/Financeiro.tsx`

**Interfaces:**
- Consumes: `Periodo`, `resolverJanela`, `periodoToParams` (de `src/lib/metricas.ts`); `useResumoVendas(janela)`.
- Produces: estado `periodo: Periodo` na tela; UI de presets (7/30/90) + botão "Personalizado" que revela 2 `<input type="date">` (de/até) e aplica `{ tipo: 'range', desde, ate }`.

- [ ] **Step 1: Trocar o estado de período**

Em `src/pages/Financeiro.tsx`, substitua o estado e a janela:

```tsx
import { useMemo, useState } from 'react';
import { periodoToParams, resolverJanela, type Periodo, type PeriodoDias } from '@/lib/metricas';
import { Input } from '@/components/ui/input';
// ...
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  // query string p/ o link do detalhe usa o período atual (preset OU range):
  const queryDetalhe = new URLSearchParams(periodoToParams(periodo)).toString();
```

Remova a constante `PERIODOS` baseada em `PeriodoDias` fixo e o `periodo === p.dias`; ver Step 2.

- [ ] **Step 2: Render dos presets + personalizado**

Substitua o bloco do seletor de período (atual `{/* Seletor de período */}`) por:

```tsx
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Vendas aprovadas em</span>
        <div className="flex gap-1">
          {([7, 30, 90] as PeriodoDias[]).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={periodo.tipo === 'preset' && periodo.dias === d ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs"
              onClick={() => setPeriodo({ tipo: 'preset', dias: d })}
            >
              {d} dias
            </Button>
          ))}
          <Button
            size="sm"
            variant={periodo.tipo === 'range' ? 'default' : 'outline'}
            className="h-7 px-2.5 text-xs"
            onClick={() => setPeriodo((p) =>
              p.tipo === 'range' ? p : { tipo: 'range', desde: '', ate: '' })}
          >
            Personalizado
          </Button>
        </div>
        {periodo.tipo === 'range' && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date" value={periodo.desde} max={periodo.ate || undefined}
              className="h-7 w-[9.5rem] text-xs"
              onChange={(e) => setPeriodo((p) => p.tipo === 'range' ? { ...p, desde: e.target.value } : p)}
            />
            <span className="text-xs text-muted-foreground">até</span>
            <Input
              type="date" value={periodo.ate} min={periodo.desde || undefined}
              className="h-7 w-[9.5rem] text-xs"
              onChange={(e) => setPeriodo((p) => p.tipo === 'range' ? { ...p, ate: e.target.value } : p)}
            />
          </div>
        )}
      </div>
```

Observação: enquanto `desde`/`ate` estiverem vazios, `resolverJanela` produz uma janela degenerada; `useResumoVendas` simplesmente retorna vazio até as duas datas estarem preenchidas — comportamento aceitável (a tela mostra zeros). Não há crash.

- [ ] **Step 3: Verificar build/lint e tela**

Run: `pnpm lint && pnpm build`
Expected: sem erros de tipo. Suba `pnpm dev` e confirme: presets funcionam; "Personalizado" revela os dois campos; escolher de/até atualiza os KPIs; o link "Ver detalhe" carrega o mesmo período.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Financeiro.tsx
git commit -m "feat(financeiro): período personalizado (intervalo de datas) na tela principal"
```

---

### Task 4: KPIs de Lucro + Margem + cobertura, e breakdown de taxas

**Files:**
- Modify: `src/pages/Financeiro.tsx`

**Interfaces:**
- Consumes: `r.lucro`, `r.margem`, `r.markup`, `r.vendasComCusto`, `r.totalVendas`, `r.comissao`, `r.frete`, `r.descontos` (de `useResumoVendas`); `fmtBRL`.

- [ ] **Step 1: Breakdown no KPI de taxas**

No card "Taxas e frete (ML)", troque o `sub` para mostrar a quebra. Localize o `<Kpi icon={Percent} label="Taxas e frete (ML)" .../>` e adicione `sub`:

```tsx
        <Kpi
          icon={Percent}
          label="Taxas e frete (ML)"
          valor={fmtBRL(r?.descontos ?? 0)}
          tom="warning"
          sub={`comissão ${fmtBRL(r.comissao)} · frete ${fmtBRL(r.frete)}`}
        />
```

- [ ] **Step 2: KPI Lucro + Margem com nota de cobertura**

Adicione, na grade de KPIs (junto a "Markup no período"), um card de lucro:

```tsx
        <Kpi
          icon={TrendingUp}
          label="Lucro líquido no período"
          valor={r.margem != null ? fmtBRL(r.lucro) : '—'}
          valorCor={r.margem != null ? (r.lucro >= 0 ? 'text-success' : 'text-destructive') : undefined}
          tom={r.margem != null && r.lucro < 0 ? 'danger' : 'success'}
          sub={r.margem != null
            ? `margem ${Math.round(r.margem * 100)}% · sobre ${r.vendasComCusto}/${r.totalVendas} venda(s) c/ custo`
            : 'sem custo cadastrado nas vendas'}
        />
```

(Use um ícone distinto do markup se quiser — ex. importe `Coins` de `lucide-react`. O markup existente permanece.)

- [ ] **Step 3: Verificar**

Run: `pnpm lint && pnpm build`
Expected: ok. Em `pnpm dev`, confira: taxas mostram "comissão X · frete Y"; lucro mostra R$ + margem% + "sobre N/M venda(s) c/ custo"; com 0 custo cadastrado mostra "—".

- [ ] **Step 4: Commit**

```bash
git add src/pages/Financeiro.tsx
git commit -m "feat(financeiro): lucro+margem com cobertura e breakdown comissão/frete"
```

---

### Task 5: Faixa de Caixa (já liberado vs a liberar)

**Files:**
- Modify: `src/pages/Financeiro.tsx`

**Interfaces:**
- Consumes: `r.liberado`, `r.aLiberar`, `r.proximaLiberacao`; `fmtBRL`.

- [ ] **Step 1: Render da faixa de caixa**

Acima da grade de "Quantidade de vendas + markup", insira uma faixa de 2 cards:

```tsx
      {/* Caixa: liberação dos recebimentos destas vendas (NÃO é o "A receber" do MP) */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Kpi
          icon={Wallet}
          label="Já liberado"
          valor={fmtBRL(r.liberado)}
          tom="success"
          sub="recebimentos destas vendas já no saldo"
        />
        <Kpi
          icon={CalendarClock}
          label="A liberar"
          valor={fmtBRL(r.aLiberar)}
          tom="warning"
          sub={r.proximaLiberacao
            ? `próxima em ${new Date(r.proximaLiberacao).toLocaleDateString('pt-BR')}`
            : 'nada pendente de liberação'}
        />
      </div>
```

Importe `CalendarClock` de `lucide-react` no topo.

- [ ] **Step 2: Verificar**

Run: `pnpm lint && pnpm build`
Expected: ok. Em `pnpm dev`, confira os dois cards e que "A receber" NÃO aparece como rótulo (compliance ADR-0031).

- [ ] **Step 3: Commit**

```bash
git add src/pages/Financeiro.tsx
git commit -m "feat(financeiro): faixa de caixa — já liberado vs a liberar"
```

---

### Task 6: Comparativo com o período anterior

**Files:**
- Modify: `src/pages/Financeiro.tsx`
- Modify: `src/lib/metricas.ts` (helper `janelaAnterior`)
- Modify: `src/lib/__tests__/resumo-vendas.test.ts` ou novo `src/lib/__tests__/metricas.test.ts`

**Interfaces:**
- Produces: `janelaAnterior(j: Janela): Janela` — janela imediatamente anterior de mesma duração (`[desde - dur, desde]`).
- Consumes na tela: segunda chamada `useResumoVendas(janelaAnterior(janela))`; helper local `delta(atual, anterior)` → `{ texto: string; trend: 'up'|'down'|'neutral' }`.

- [ ] **Step 1: Test do helper de janela**

```ts
// src/lib/__tests__/metricas.test.ts
import { describe, it, expect } from 'vitest';
import { janelaAnterior } from '../metricas';

describe('janelaAnterior', () => {
  it('devolve a janela anterior de mesma duração', () => {
    const j = { desde: '2026-06-01T00:00:00.000Z', ate: '2026-06-11T00:00:00.000Z' }; // 10 dias
    const a = janelaAnterior(j);
    expect(a.ate).toBe('2026-06-01T00:00:00.000Z');
    expect(a.desde).toBe('2026-05-22T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test (fail)**

Run: `pnpm test -- metricas`
Expected: FAIL — `janelaAnterior` not exported.

- [ ] **Step 3: Implementar em `src/lib/metricas.ts`**

```ts
/** Janela imediatamente anterior, de mesma duração: [desde - dur, desde]. */
export function janelaAnterior(j: Janela): Janela {
  const desdeMs = Date.parse(j.desde);
  const dur = Date.parse(j.ate) - desdeMs;
  return { desde: new Date(desdeMs - dur).toISOString(), ate: new Date(desdeMs).toISOString() };
}
```

- [ ] **Step 4: Run test (pass)**

Run: `pnpm test -- metricas`
Expected: PASS.

- [ ] **Step 5: Consumir o comparativo na tela**

Em `Financeiro.tsx`, após o `useResumoVendas(janela)` atual:

```tsx
import { janelaAnterior } from '@/lib/metricas';
// ...
  const janelaAnt = useMemo(() => janelaAnterior(janela), [janela]);
  const { resumo: rAnt } = useResumoVendas(janelaAnt);

  // Delta percentual vs período anterior; trend define cor/seta no KPI.
  const delta = (atual: number, anterior: number): { texto: string; trend: 'up' | 'down' | 'neutral' } => {
    if (anterior === 0) return { texto: atual > 0 ? 'novo' : '—', trend: atual > 0 ? 'up' : 'neutral' };
    const p = ((atual - anterior) / Math.abs(anterior)) * 100;
    const trend = p > 0.5 ? 'up' : p < -0.5 ? 'down' : 'neutral';
    return { texto: `${p >= 0 ? '+' : ''}${Math.round(p)}% vs. anterior`, trend };
  };
```

- [ ] **Step 6: Mostrar o delta nos KPIs-chave**

Estenda o componente local `Kpi` para aceitar `delta?: { texto: string; trend: 'up'|'down'|'neutral' }` e renderizar uma linha com seta (reaproveite a lógica de cor de `KpiCard`: up=`text-success`, down=`text-destructive`, neutral=`text-muted-foreground`, ícones `ArrowUp`/`ArrowDown` de `lucide-react`). Aplique `delta={delta(r.liquido, rAnt.liquido)}` no hero/líquido, `delta(r.bruto, rAnt.bruto)` no bruto, `delta(r.lucro, rAnt.lucro)` no lucro e `delta(r.pedidos, rAnt.pedidos)` em vendas.

Trecho a adicionar dentro do `Kpi` (antes do `sub`):

```tsx
  delta?: { texto: string; trend: 'up' | 'down' | 'neutral' };
// ...no corpo, após o valor:
      {delta && (
        <div className={cn('mt-0.5 flex items-center gap-0.5 text-xs',
          delta.trend === 'up' ? 'text-success' : delta.trend === 'down' ? 'text-destructive' : 'text-muted-foreground')}>
          {delta.trend === 'up' ? <ArrowUp className="h-3 w-3" /> : delta.trend === 'down' ? <ArrowDown className="h-3 w-3" /> : null}
          {delta.texto}
        </div>
      )}
```

Importe `ArrowUp, ArrowDown` de `lucide-react`.

- [ ] **Step 7: Verificar**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: tudo verde. Em `pnpm dev`, confira setas/percentuais nos 4 KPIs e que trocar o período recalcula o comparativo.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Financeiro.tsx src/lib/metricas.ts src/lib/__tests__/metricas.test.ts
git commit -m "feat(financeiro): comparativo com período anterior nos KPIs-chave"
```

---

### Task 7: Gráfico de evolução temporal

**Files:**
- Create: `src/components/financeiro/grafico-evolucao.tsx`
- Modify: `src/pages/Financeiro.tsx`

**Interfaces:**
- Consumes: `agruparPorPeriodo` (Task 2), `r.vendas` não — usa as vendas cruas. Para isso, expor as vendas: `useResumoVendas` já devolve `resumo.vendas` (VendaResumo) mas o gráfico precisa de `Venda[]` faturáveis com `total_amount/liquido/date`. `VendaResumo` já tem `data`, `bruto`, `liquido` → podemos agrupar a partir de `resumo.vendas`. **Decisão:** criar uma sobrecarga simples no componente que recebe `PontoSerie[]` pronto, e a página monta a série a partir de `resumo.vendas` com uma adaptação local. Para manter `agruparPorPeriodo` testado e único, adicione um seletor de passo na página: `dias <= 31 ? 'dia' : 'semana'`.

Como `agruparPorPeriodo` recebe `Venda[]` e a página tem `resumo.vendas` (`VendaResumo[]`), e `VendaResumo` carrega `data/bruto/liquido`, criamos um agrupador fino que aceita os campos mínimos. **Ajuste à Task 2:** generalizar a entrada.

- [ ] **Step 1: Generalizar `agruparPorPeriodo` para campos mínimos (ajuste)**

Em `src/lib/resumo-vendas.ts`, troque a assinatura para aceitar o mínimo necessário e atualize o corpo (substitui o `v.date_closed ?? v.date_created` e o filtro de status):

```ts
export interface ItemSerie { data: string | null; bruto: number; liquido: number }

/** Série temporal (bruto/líquido) por dia ou semana. Recebe itens já faturáveis (a página passa
 *  resumo.vendas, que só contém faturáveis). UTC na chave; rótulo DD/MM; ordenada crescente. */
export function agruparPorPeriodo(itens: ItemSerie[], passo: 'dia' | 'semana'): PontoSerie[] {
  const mapa = new Map<string, { rotulo: string; bruto: number; liquido: number }>();
  for (const v of itens) {
    if (!v.data) continue;
    const d = new Date(v.data);
    if (passo === 'semana') d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const chave = `${yyyy}-${mm}-${dd}`;
    const acc = mapa.get(chave) ?? { rotulo: `${dd}/${mm}`, bruto: 0, liquido: 0 };
    acc.bruto += v.bruto;
    acc.liquido += v.liquido;
    mapa.set(chave, acc);
  }
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([chave, a]) => ({ chave, rotulo: a.rotulo, bruto: round2(a.bruto), liquido: round2(a.liquido) }));
}
```

Atualize o teste da Task 2 para passar itens `{ data, bruto, liquido }` (já são faturáveis):

```ts
  it('agrupa líquido e bruto por dia, ordenado', () => {
    const itens = [
      { data: '2026-06-10T09:00:00Z', bruto: 100, liquido: 80 },
      { data: '2026-06-10T18:00:00Z', bruto: 50, liquido: 40 },
      { data: '2026-06-11T10:00:00Z', bruto: 30, liquido: 25 },
    ];
    const serie = agruparPorPeriodo(itens, 'dia');
    expect(serie).toHaveLength(2);
    expect(serie[0]).toMatchObject({ chave: '2026-06-10', rotulo: '10/06', bruto: 150, liquido: 120 });
    expect(serie[1]).toMatchObject({ chave: '2026-06-11', liquido: 25 });
  });
```

Run: `pnpm test -- resumo-vendas` → PASS.

- [ ] **Step 2: Componente do gráfico**

```tsx
// src/components/financeiro/grafico-evolucao.tsx
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { fmtBRL } from '@/lib/formato';
import type { PontoSerie } from '@/lib/resumo-vendas';

/** Evolução do líquido por dia/semana no período. Vazio → mensagem. */
export function GraficoEvolucao({ serie }: { serie: PontoSerie[] }) {
  if (serie.length === 0) {
    return <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Sem vendas no período.</div>;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" />
          <YAxis tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground"
            tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} width={40} />
          <Tooltip
            formatter={(v: number, nome) => [fmtBRL(v), nome === 'liquido' ? 'Líquido' : 'Bruto']}
            labelClassName="text-foreground" contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="liquido" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Montar a série e renderizar na página**

Em `Financeiro.tsx`:

```tsx
import { agruparPorPeriodo } from '@/lib/resumo-vendas';
import { GraficoEvolucao } from '@/components/financeiro/grafico-evolucao';
// ...
  const passo = periodo.tipo === 'preset' && periodo.dias <= 31 ? 'dia'
    : periodo.tipo === 'range'
      ? ((Date.parse(janela.ate) - Date.parse(janela.desde)) / 86_400_000 <= 31 ? 'dia' : 'semana')
      : 'semana';
  const serie = useMemo(() => agruparPorPeriodo(r.vendas, passo), [r.vendas, passo]);
```

E, abaixo das faixas de KPIs, adicione a seção:

```tsx
      <div className="mt-6 rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-2 text-sm font-medium">Evolução do líquido ({passo === 'dia' ? 'por dia' : 'por semana'})</div>
        <GraficoEvolucao serie={serie} />
      </div>
```

- [ ] **Step 4: Verificar**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: verde. Em `pnpm dev`, confirme o gráfico em 7/30 dias (por dia) e 90 dias (por semana), light + dark.

- [ ] **Step 5: Commit**

```bash
git add src/lib/resumo-vendas.ts src/lib/__tests__/resumo-vendas.test.ts src/components/financeiro/grafico-evolucao.tsx src/pages/Financeiro.tsx
git commit -m "feat(financeiro): gráfico de evolução do líquido (recharts)"
```

---

### Task 8: Export CSV no detalhe

**Files:**
- Create: `src/lib/csv.ts`
- Create: `src/lib/__tests__/csv.test.ts`
- Modify: `src/pages/DetalheFinanceiro.tsx`

**Interfaces:**
- Produces: `montarCsv(linhas: Array<Record<string, string | number | null>>, colunas: Array<{ chave: string; titulo: string }>): string` — CSV com `;` (Excel pt-BR), cabeçalho, escapando aspas/®quebra; `null`→vazio. E `baixarCsv(nome: string, conteudo: string): void` (cria Blob + `<a download>`).

- [ ] **Step 1: Test do montador**

```ts
// src/lib/__tests__/csv.test.ts
import { describe, it, expect } from 'vitest';
import { montarCsv } from '../csv';

describe('montarCsv', () => {
  it('gera cabeçalho + linhas com ; e escapa aspas/; ', () => {
    const csv = montarCsv(
      [{ a: 'fita "azul"; 10m', b: 12.5, c: null }],
      [{ chave: 'a', titulo: 'Produto' }, { chave: 'b', titulo: 'Valor' }, { chave: 'c', titulo: 'X' }],
    );
    expect(csv).toBe('Produto;Valor;X\n"fita ""azul""; 10m";12.5;');
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `pnpm test -- csv`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/lib/csv.ts`**

```ts
/** Escapa um campo CSV: aspas duplicadas e envolve em aspas se tiver ; aspas ou quebra. */
function campo(v: string | number | null): string {
  if (v == null) return '';
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Monta CSV com separador ';' (Excel pt-BR). */
export function montarCsv(
  linhas: Array<Record<string, string | number | null>>,
  colunas: Array<{ chave: string; titulo: string }>,
): string {
  const head = colunas.map((c) => campo(c.titulo)).join(';');
  const body = linhas.map((l) => colunas.map((c) => campo(l[c.chave])).join(';'));
  return [head, ...body].join('\n');
}

/** Dispara o download de um CSV no browser (BOM p/ acentos no Excel). */
export function baixarCsv(nome: string, conteudo: string): void {
  const blob = new Blob(['﻿', conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run (pass)**

Run: `pnpm test -- csv`
Expected: PASS.

- [ ] **Step 5: Botão "Exportar CSV" no detalhe**

Em `DetalheFinanceiro.tsx`, importe e adicione um botão no `actions` do `PageHeader`. Exporta `vendasOrdenadas` (respeita ordenação e o filtro da Task 9):

```tsx
import { Download } from 'lucide-react';
import { montarCsv, baixarCsv } from '@/lib/csv';
// ...
  const exportar = () => {
    const linhas = vendasOrdenadas.map((v) => ({
      codigo: v.codigo, produto: v.descricao ?? `#${v.id}`, data: fmtData(v.data),
      liberacao: fmtData(v.dataLiberacao),
      situacao: v.dataLiberacao ? (new Date(v.dataLiberacao).getTime() <= Date.now() ? 'liberado' : 'a liberar') : '',
      bruto: v.bruto, retido: v.retido, liquido: v.liquido,
      markup: markupValor(v) != null ? `${Math.round(markupValor(v)! * 100)}%` : '',
    }));
    const csv = montarCsv(linhas, [
      { chave: 'codigo', titulo: 'Código' }, { chave: 'produto', titulo: 'Produto' },
      { chave: 'data', titulo: 'Data' }, { chave: 'liberacao', titulo: 'Liberação' },
      { chave: 'situacao', titulo: 'Situação' }, { chave: 'bruto', titulo: 'Bruto' },
      { chave: 'retido', titulo: 'Retido' }, { chave: 'liquido', titulo: 'Líquido' },
      { chave: 'markup', titulo: 'Markup' },
    ]);
    baixarCsv(`financeiro-${rotuloPeriodo(periodo).replace(/[^0-9a-z]+/gi, '-')}.csv`, csv);
  };
```

E o botão (antes do "Atualizar"):

```tsx
            <Button variant="outline" size="sm" onClick={exportar} disabled={vendasOrdenadas.length === 0}>
              <Download className="mr-1.5 h-4 w-4" />Exportar CSV
            </Button>
```

- [ ] **Step 6: Verificar**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: verde. Em `pnpm dev`, baixe o CSV e abra no Excel/Sheets: acentos ok, colunas certas, respeita ordenação.

- [ ] **Step 7: Commit**

```bash
git add src/lib/csv.ts src/lib/__tests__/csv.test.ts src/pages/DetalheFinanceiro.tsx
git commit -m "feat(financeiro): exportar detalhe do líquido em CSV"
```

---

### Task 9: Filtro liberado/a liberar + retido negativo no detalhe

**Files:**
- Modify: `src/pages/DetalheFinanceiro.tsx`

**Interfaces:**
- Consumes: `vendas` (já em memória), `r.vendas`.
- Produces: estado `filtroLib: 'todos' | 'liberado' | 'aliberar'`; `vendasOrdenadas` passa a aplicar o filtro antes da ordenação; célula de retido trata negativo como "crédito".

- [ ] **Step 1: Estado + chips de filtro**

Em `DetalheFinanceiro.tsx`:

```tsx
  const [filtroLib, setFiltroLib] = useState<'todos' | 'liberado' | 'aliberar'>('todos');
  const liberadoDe = (iso: string | null) => iso != null && new Date(iso).getTime() <= Date.now();
```

Aplique o filtro na base antes de ordenar (no `useMemo` de `vendasOrdenadas`, comece de uma lista já filtrada):

```tsx
  const vendasFiltradas = useMemo(() => vendas.filter((v) => {
    if (filtroLib === 'liberado') return liberadoDe(v.dataLiberacao);
    if (filtroLib === 'aliberar') return v.dataLiberacao != null && !liberadoDe(v.dataLiberacao);
    return true;
  }), [vendas, filtroLib]);
```

E troque `[...vendas]` por `[...vendasFiltradas]` dentro do sort, e `if (!sort) return vendas;` por `if (!sort) return vendasFiltradas;`.

Chips (acima da tabela):

```tsx
      <div className="mb-3 flex gap-1">
        {([['todos', 'Todos'], ['liberado', 'Liberados'], ['aliberar', 'A liberar']] as const).map(([k, lbl]) => (
          <Button key={k} size="sm" variant={filtroLib === k ? 'default' : 'outline'}
            className="h-7 px-2.5 text-xs" onClick={() => setFiltroLib(k)}>{lbl}</Button>
        ))}
      </div>
```

- [ ] **Step 2: Retido negativo = crédito**

Substitua a célula de "Retido" por uma que trate o negativo (líquido > bruto):

```tsx
                  <TableCell className={cn('align-top text-right text-sm tabular-nums',
                    v.retido < 0 ? 'text-success' : 'text-warning')}>
                    {v.retido < 0 ? `+${fmtBRL(-v.retido)}` : fmtBRL(v.retido)}
                    {v.retido < 0 && <span className="block text-xs text-muted-foreground">crédito</span>}
                  </TableCell>
```

- [ ] **Step 3: Verificar**

Run: `pnpm lint && pnpm build`
Expected: ok. Em `pnpm dev`: chips filtram; uma linha com líquido > bruto mostra "+R$ x · crédito" em verde, sem vermelho-alarme; CSV (Task 8) respeita o filtro.

- [ ] **Step 4: Commit**

```bash
git add src/pages/DetalheFinanceiro.tsx
git commit -m "feat(financeiro): filtro liberado/a liberar e retido negativo como crédito"
```

---

### Task 10: Migration — coluna de idempotência da notificação

**Files:**
- Create: `supabase/migrations/20260623160000_ml_vendas_liberacao_notificada.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- Idempotência da notificação de liberação (edge notificar-liberacao): marca quando o aviso de
-- "dinheiro liberado hoje" foi enviado para a venda, evitando reenvio se o schedule repetir.
alter table public.ml_vendas
  add column if not exists liberacao_notificada_em date;

comment on column public.ml_vendas.liberacao_notificada_em is
  'Data em que a notificação Telegram de liberação foi enviada para esta venda (null = ainda não).';
```

- [ ] **Step 2: Aplicar na base**

Aplique via Supabase MCP `apply_migration` (name: `ml_vendas_liberacao_notificada`) OU `supabase db push` com o `SUPABASE_ACCESS_TOKEN` do `.env.local`. Confirme a coluna:

Run (MCP `execute_sql`): `select column_name from information_schema.columns where table_name='ml_vendas' and column_name='liberacao_notificada_em';`
Expected: 1 linha.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260623160000_ml_vendas_liberacao_notificada.sql
git commit -m "feat(financeiro): coluna liberacao_notificada_em p/ idempotência da notificação"
```

---

### Task 11: Mensagem de liberação (pura) + teste

**Files:**
- Modify: `supabase/functions/_shared/notificacoes/telegram.ts`
- Modify: `supabase/functions/_shared/notificacoes/__tests__/telegram.test.ts`

**Interfaces:**
- Produces: `montarMensagemLiberacao(total: number, n: number, moeda: string): string`.

- [ ] **Step 1: Test**

Adicione em `telegram.test.ts`:

```ts
import { montarMensagemLiberacao } from '../telegram.ts';

Deno.test('montarMensagemLiberacao — total e contagem', () => {
  const msg = montarMensagemLiberacao(364.46, 3, 'BRL');
  if (!msg.includes('R$ 364,46')) throw new Error('faltou o total');
  if (!msg.includes('3 venda')) throw new Error('faltou a contagem');
});
```

(Confirme o runner: estes testes usam `Deno.test`. Rode com `deno test supabase/functions/_shared/notificacoes/`.)

- [ ] **Step 2: Run (fail)**

Run: `deno test supabase/functions/_shared/notificacoes/__tests__/telegram.test.ts`
Expected: FAIL — `montarMensagemLiberacao` não existe.

- [ ] **Step 3: Implementar (reusa `fmtBRL` local do arquivo)**

Em `telegram.ts`, adicione:

```ts
export function montarMensagemLiberacao(total: number, n: number, moeda: string): string {
  const plural = n === 1 ? 'venda' : 'vendas';
  return [
    `💰 Hoje libera ${fmtBRL(total, moeda)} no seu saldo Mercado Pago`,
    `Referente a ${n} ${plural} cujo prazo de liberação venceu hoje.`,
  ].join('\n');
}
```

- [ ] **Step 4: Run (pass)**

Run: `deno test supabase/functions/_shared/notificacoes/__tests__/telegram.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/notificacoes/telegram.ts supabase/functions/_shared/notificacoes/__tests__/telegram.test.ts
git commit -m "feat(financeiro): mensagem Telegram de liberação (pura + teste)"
```

---

### Task 12: Edge `notificar-liberacao`

**Files:**
- Create: `supabase/functions/notificar-liberacao/index.ts`

**Interfaces:**
- Consumes: `adminClient` (`_shared/supabase.ts`), `lerConfigTelegram` (`_shared/notificacoes/config.ts`), `enviarTelegram` + `montarMensagemLiberacao` (`_shared/notificacoes/telegram.ts`), `corsHeaders`/`handleOptions` (`_shared/cors.ts`).
- Comportamento: para cada `user_id` com vendas a notificar hoje, soma o líquido, envia e marca. `verify_jwt = false` (QStash).

- [ ] **Step 1: Implementar a edge**

```ts
// supabase/functions/notificar-liberacao/index.ts
// Notifica no Telegram quando recebimentos de vendas são liberados HOJE no saldo Mercado Pago.
// Chamada por schedule diário do QStash (verify_jwt=false). Idempotente: só pega vendas cujo
// money_release_date é hoje e que ainda não foram notificadas (liberacao_notificada_em null),
// marcando-as após o envio. NÃO é o "A receber" do MP — é a liberação por-venda (ADR-0031).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { lerConfigTelegram } from '../_shared/notificacoes/config.ts';
import { enviarTelegram, montarMensagemLiberacao } from '../_shared/notificacoes/telegram.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();

  const admin = adminClient();
  // Dia corrente em America/Sao_Paulo (a base guarda money_release_date; comparamos pela data local).
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD

  // Vendas cujo prazo de liberação é hoje e ainda não notificadas. Faturáveis e com líquido.
  const { data: vendas, error } = await admin
    .from('ml_vendas')
    .select('id, user_id, liquido, money_release_date, status')
    .gte('money_release_date', `${hoje}T00:00:00`)
    .lte('money_release_date', `${hoje}T23:59:59`)
    .is('liberacao_notificada_em', null)
    .in('status', ['paid', 'partially_refunded', 'refunded']);

  if (error) {
    return json({ erro: error.message }, 500);
  }
  if (!vendas || vendas.length === 0) {
    return json({ notificados: 0, usuarios: 0 });
  }

  // Agrupa por usuário.
  const porUser = new Map<string, { ids: string[]; total: number }>();
  for (const v of vendas as Array<{ id: string; user_id: string; liquido: number | null }>) {
    const acc = porUser.get(v.user_id) ?? { ids: [], total: 0 };
    acc.ids.push(v.id);
    acc.total += v.liquido ?? 0;
    porUser.set(v.user_id, acc);
  }

  let usuarios = 0;
  let notificados = 0;
  for (const [userId, { ids, total }] of porUser) {
    const cfg = await lerConfigTelegram(admin, userId);
    if (cfg.ativo && cfg.token && cfg.chatId && total > 0) {
      const enviado = await enviarTelegram(
        cfg.token, cfg.chatId, montarMensagemLiberacao(Math.round(total * 100) / 100, ids.length, 'BRL'),
      );
      if (enviado) usuarios += 1;
    }
    // Marca SEMPRE (mesmo sem Telegram ativo) para não reprocessar amanhã.
    await admin.from('ml_vendas').update({ liberacao_notificada_em: hoje }).in('id', ids);
    notificados += ids.length;
  }

  return json({ notificados, usuarios });
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 2: Garantir `verify_jwt=false`**

Confirme/edite `supabase/config.toml` adicionando o bloco da função (espelhe outra função chamada por QStash, ex. `sync-venda`):

```toml
[functions.notificar-liberacao]
verify_jwt = false
```

- [ ] **Step 3: Deploy + smoke**

Deploy via CLI completa (regra "deploy nunca defasado", com `SUPABASE_ACCESS_TOKEN` do `.env.local`):

Run: `supabase functions deploy notificar-liberacao`
Smoke (POST manual): `curl -X POST "$VITE_SUPABASE_URL/functions/v1/notificar-liberacao"`
Expected: JSON `{ notificados, usuarios }` (pode ser 0/0 se nada vence hoje — sem erro).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/notificar-liberacao/index.ts supabase/config.toml
git commit -m "feat(financeiro): edge notificar-liberacao (Telegram diário, idempotente)"
```

- [ ] **Step 5: HANDOFF ao Diego — schedule QStash**

Documente (e avise o Diego) que falta criar o **schedule diário** no QStash apontando para
`POST $VITE_SUPABASE_URL/functions/v1/notificar-liberacao` (ex.: cron `0 12 * * *` UTC ≈ 09h BRT).
Sem o schedule a edge não dispara sozinha. Esta etapa é manual (não dá para automatizar pelo agente).

---

### Task 13: ADR-0040

**Files:**
- Create: `docs/decisions/0040-financeiro-caixa-evolucao-notificacao.md`
- Modify: `docs/project-status.md` (linha no snapshot) e `docs/TASKS.md` (checklist)

- [ ] **Step 1: Escrever o ADR**

Conteúdo cobrindo: contexto (espelhar o Faturamento), decisão (caixa por-liberação derivada de `ml_vendas`; breakdown comissão/frete; lucro+margem+cobertura; evolução; comparativo; período personalizado; export; notificação diária idempotente), consequências, e a **ressalva explícita** de que a faixa de Caixa NÃO é o "A receber" do MP (mantém ADR-0031) e o schedule QStash é dependência manual. Referencie ADR-0031 e ADR-0038.

- [ ] **Step 2: Atualizar status/TASKS**

Acrescente uma linha em `project-status.md` (trilho do Financeiro) e um item em `TASKS.md` marcando o módulo entregue (menos o schedule QStash, que fica pendente do Diego, e a limpeza do caminho morto, pendente de validação).

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0040-financeiro-caixa-evolucao-notificacao.md docs/project-status.md docs/TASKS.md
git commit -m "docs(financeiro): ADR-0040 e atualização de status/TASKS"
```

---

### Task 14: Limpeza do caminho morto do MP — SOMENTE PÓS-VALIDAÇÃO DO DIEGO

> ⚠️ **NÃO executar junto das tasks acima.** Só rodar depois que o Diego validar todo o módulo e confirmar que não vamos precisar da ponte ao vivo com o Mercado Pago.

**Files:**
- Delete: `src/lib/financeiro.ts`
- Delete: `src/hooks/useResumoFinanceiro.ts`
- Delete: `supabase/functions/resumo-financeiro/` (e o bloco em `config.toml`, se houver)

- [ ] **Step 1: Confirmar que ninguém importa**

Run: `grep -rn "useResumoFinanceiro\|lib/financeiro\|resumo-financeiro" src supabase | grep -v "resumo-vendas"`
Expected: vazio (fora de comentários). Se algo aparecer, parar e reavaliar.

- [ ] **Step 2: Deletar e validar**

Remova os arquivos; rode `pnpm lint && pnpm build && pnpm test` → verde.

- [ ] **Step 3: Commit**

```bash
git rm src/lib/financeiro.ts src/hooks/useResumoFinanceiro.ts
git rm -r supabase/functions/resumo-financeiro
git commit -m "chore(financeiro): remover caminho morto do MP (substituído por ml_vendas/ADR-0038)"
```

---

## Self-Review

**Spec coverage:**
- Período personalizado → Task 3 ✓
- Notificação Telegram → Tasks 10–12 ✓ (+ handoff schedule)
- Caixa liberado/a liberar → Task 1 (lógica) + Task 5 (UI) ✓
- Breakdown taxas → Task 1 (lógica) + Task 4 (UI) ✓
- Gráfico evolução → Task 2/7 ✓
- Export CSV → Task 8 ✓
- Comparativo período anterior → Task 6 ✓
- Lucro + Margem → Task 1 + Task 4 ✓
- Cobertura de custo → Task 1 + Task 4 ✓
- Retido negativo → Task 9 ✓
- Limpeza caminho morto → Task 14 (gated) ✓
- ADR + docs → Task 13 ✓

**Type consistency:** `ResumoVendas` novos campos (`liberado`, `aLiberar`, `proximaLiberacao`, `comissao`, `frete`, `vendasComCusto`, `totalVendas`, `margem`) definidos na Task 1 e consumidos nas Tasks 4/5/6/7. `agruparPorPeriodo(ItemSerie[], passo)` definido na Task 7 (generaliza a Task 2). `montarCsv`/`baixarCsv` (Task 8), `montarMensagemLiberacao(total,n,moeda)` (Tasks 11/12), `janelaAnterior` (Task 6) — assinaturas batem entre definição e uso.

**Nota de ordenação:** a Task 2 cria `agruparPorPeriodo(Venda[])` e a Task 7 a **redefine** para `ItemSerie[]` (campos mínimos) — Task 7 inclui o ajuste do teste. Quem executar em ordem aplica a versão final na Task 7; sem conflito porque é o mesmo arquivo/função e o teste é atualizado junto.
