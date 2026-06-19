# Detalhe de Vendas + Intervalo de Datas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o card Faturamento clicável abrindo uma tela de composição por anúncio (app vs. fora do PubliAI, somando ao total global), e adicionar a opção de intervalo de datas personalizado ao filtro de período.

**Architecture:** Backend agrega também os itens fora do escopo e resolve seus títulos no ML, devolvendo um campo opcional `externos` em `metricas-vendas`. Frontend generaliza o período (preset ou intervalo livre), propaga via URL, e renderiza uma página nova `/publicados/vendas` a partir de uma função pura de composição.

**Tech Stack:** React 18 + TypeScript + Vite + react-router-dom (HashRouter) + TanStack Query + shadcn/ui + Tailwind; Supabase Edge Functions (Deno); Vitest + Testing Library (jsdom).

## Global Constraints

- **Sem dependências novas.** Intervalo de datas usa `<input type="date">` nativo.
- **Tipo `MetricasVendasCanal` ganha campo opcional** (`externos?`) — o dashboard atual continua funcionando sem mudança de forma.
- **Multicanal:** tipos e métodos permanecem canônicos (não acoplar nomes a "Mercado Livre").
- **Base:** esta branch (`worktree-detalhe-vendas-faturamento`) será **rebaseada na `main` atualizada** depois que o Financeiro for commitado. O Financeiro adiciona um banner no topo de `src/pages/Publicados.tsx`; aplique as edições deste plano na **região do seletor de período / dashboard**, independentemente do banner.
- **TDD obrigatório** (RED→GREEN), commits frequentes, mudanças cirúrgicas.
- Comando de teste: `npx vitest run <arquivo>`. Typecheck: `npx tsc --noEmit -p tsconfig.json`.

## File Structure

**Backend:**
- Modify `supabase/functions/_shared/canais/contrato.ts` — tipo `ItemExternoVenda` + `externos?` em `MetricasVendasCanal`.
- Modify `supabase/functions/_shared/ml/vendas.ts` — `AgregadoPedidos` + `agregarPedidos` agrega externos; `montarExternos`; `lerVendasML` resolve títulos.
- Modify `supabase/functions/_shared/ml/__tests__/vendas.test.ts` — casos de externos.

**Frontend:**
- Modify `src/lib/metricas.ts` — `Periodo`, `resolverJanela`, `periodoToParams`/`periodoFromParams`, `buscarMetricasVendas(janela)`, `externos?` em `MetricasVendas`.
- Create `src/lib/__tests__/metricas.test.ts` — testes puros.
- Create `src/lib/detalhe-vendas.ts` — `montarDetalheVendas` (pura).
- Create `tests/lib/detalhe-vendas.test.ts`.
- Modify `src/hooks/useMetricasVendas.ts` — recebe `Janela`, keyed por janela.
- Modify `src/components/dashboard-publicados.tsx` — seletor com "Personalizado" + De/Até; card Faturamento vira `<Link>`.
- Modify `src/pages/Publicados.tsx` — estado `Periodo`, calcula `janela`.
- Create `src/pages/DetalheVendas.tsx` — página de composição.
- Modify `src/App.tsx` — rota `/publicados/vendas`.

---

### Task 1: Backend — `agregarPedidos` separa itens externos

**Files:**
- Modify: `supabase/functions/_shared/canais/contrato.ts`
- Modify: `supabase/functions/_shared/ml/vendas.ts`
- Test: `supabase/functions/_shared/ml/__tests__/vendas.test.ts`

**Interfaces:**
- Produces: `AgregadoPedidos { porItem, porItemExterno, totais }` (exportado de `vendas.ts`); `ItemExternoVenda { id; titulo; unidades; valor }` e `MetricasVendasCanal.externos?: ItemExternoVenda[]` (em `contrato.ts`).

- [ ] **Step 1: Adicionar tipos no contrato**

Em `supabase/functions/_shared/canais/contrato.ts`, substitua o bloco `MetricasVendasCanal`:

```ts
/** Um item que vendeu mas está fora do escopo do app (publicado direto no canal). */
export interface ItemExternoVenda {
  id: string;
  titulo: string;
  unidades: number;
  valor: number;
}

/** Métricas de venda de um período, no modelo canônico (multicanal). */
export interface MetricasVendasCanal {
  /** itemExternoId → vendas do período (só itens dentro do escopo consultado). */
  porItem: Record<string, { unidades: number; valor: number }>;
  /** Totais de TODA a conta do vendedor no período — inclui anúncios fora do escopo (ADR-0032). */
  totais: { faturamento: number; unidades: number; pedidos: number };
  /** Itens fora do escopo do app que venderam no período (compõem o total — detalhe de vendas). */
  externos?: ItemExternoVenda[];
}
```

- [ ] **Step 2: Escrever o teste que falha (externos em `agregarPedidos`)**

Em `supabase/functions/_shared/ml/__tests__/vendas.test.ts`, adicione dentro do `describe('agregarPedidos', …)`:

```ts
  it('separa itens fora do escopo em porItemExterno sem poluir porItem', () => {
    const pedidos: PedidoML[] = [
      { id: 1, order_items: [
        { item: { id: 'MLB1' }, quantity: 1, unit_price: 10 },
        { item: { id: 'FORA' }, quantity: 2, unit_price: 50 },
      ] },
      { id: 2, order_items: [{ item: { id: 'FORA' }, quantity: 1, unit_price: 50 }] },
    ];
    const r = agregarPedidos(pedidos, escopo);
    expect(r.porItem['MLB1']).toEqual({ unidades: 1, valor: 10 });
    expect(r.porItem['FORA']).toBeUndefined();
    expect(r.porItemExterno['FORA']).toEqual({ unidades: 3, valor: 150 });
    expect(r.totais).toEqual({ faturamento: 160, unidades: 4, pedidos: 2 });
  });
```

- [ ] **Step 3: Rodar o teste e confirmar a falha**

Run: `npx vitest run supabase/functions/_shared/ml/__tests__/vendas.test.ts`
Expected: FAIL (`r.porItemExterno` é `undefined`).

- [ ] **Step 4: Implementar (agregar externos)**

Em `supabase/functions/_shared/ml/vendas.ts`, ajuste imports e substitua `agregarPedidos`:

```ts
import type { MetricasVendasCanal, ItemExternoVenda } from '../canais/contrato.ts';

/** Resultado bruto da agregação (sem títulos — `montarExternos`/`lerVendasML` resolvem). */
export interface AgregadoPedidos {
  porItem: Record<string, { unidades: number; valor: number }>;
  porItemExterno: Record<string, { unidades: number; valor: number }>;
  totais: { faturamento: number; unidades: number; pedidos: number };
}

export function agregarPedidos(pedidos: PedidoML[], idsEscopo: Set<string>): AgregadoPedidos {
  const porItem: Record<string, { unidades: number; valor: number }> = {};
  const porItemExterno: Record<string, { unidades: number; valor: number }> = {};
  let faturamento = 0;
  let unidades = 0;
  let pedidosComItem = 0;

  for (const pedido of pedidos) {
    let temItem = false;
    for (const oi of pedido.order_items ?? []) {
      const qtd = Number(oi?.quantity ?? 0);
      const preco = Number(oi?.unit_price ?? 0);
      const valor = qtd * preco;
      faturamento += valor;
      unidades += qtd;
      temItem = true;
      const id = oi?.item?.id;
      if (!id) continue;
      const alvo = idsEscopo.has(id) ? porItem : porItemExterno;
      const acc = alvo[id] ?? { unidades: 0, valor: 0 };
      acc.unidades += qtd;
      acc.valor += valor;
      alvo[id] = acc;
    }
    if (temItem) pedidosComItem += 1;
  }

  return { porItem, porItemExterno, totais: { faturamento, unidades, pedidos: pedidosComItem } };
}
```

Observação: o docblock antigo de `agregarPedidos` (ADR-0032) pode ser mantido/atualizado para citar `porItemExterno`. `lerVendasML` será ajustado na Task 2 (agora `agregarPedidos` retorna `AgregadoPedidos`, então o `return` final de `lerVendasML` deixará de compilar até a Task 2 — isso é esperado dentro deste passo; o teste de unidade de `agregarPedidos` já passa).

- [ ] **Step 5: Rodar o teste e confirmar verde**

Run: `npx vitest run supabase/functions/_shared/ml/__tests__/vendas.test.ts`
Expected: PASS (todos os casos de `agregarPedidos`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/canais/contrato.ts supabase/functions/_shared/ml/vendas.ts supabase/functions/_shared/ml/__tests__/vendas.test.ts
git commit -m "feat(vendas): agregarPedidos separa itens fora do escopo em porItemExterno"
```

---

### Task 2: Backend — `lerVendasML` resolve títulos e devolve `externos`

**Files:**
- Modify: `supabase/functions/_shared/ml/vendas.ts`
- Test: `supabase/functions/_shared/ml/__tests__/vendas.test.ts`

**Interfaces:**
- Consumes: `AgregadoPedidos`, `ItemExternoVenda` (Task 1).
- Produces: `montarExternos(porItemExterno, titulos): ItemExternoVenda[]`; `lerVendasML` agora retorna `MetricasVendasCanal` com `externos` preenchido.

- [ ] **Step 1: Escrever o teste que falha (`montarExternos`)**

Em `supabase/functions/_shared/ml/__tests__/vendas.test.ts`, adicione no topo o import e um novo `describe`:

```ts
import { agregarPedidos, montarExternos, type PedidoML } from '../vendas.ts';

describe('montarExternos', () => {
  it('mapeia título por id e ordena por valor desc; usa id quando falta título', () => {
    const porItemExterno = {
      MLBX: { unidades: 5, valor: 62.5 },
      MLBY: { unidades: 2, valor: 100 },
    };
    const titulos = { MLBY: 'Produto Y' };
    const r = montarExternos(porItemExterno, titulos);
    expect(r).toEqual([
      { id: 'MLBY', titulo: 'Produto Y', unidades: 2, valor: 100 },
      { id: 'MLBX', titulo: 'MLBX', unidades: 5, valor: 62.5 },
    ]);
  });
});
```

(Atualize a linha de import existente de `agregarPedidos` para incluir `montarExternos`.)

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run supabase/functions/_shared/ml/__tests__/vendas.test.ts`
Expected: FAIL (`montarExternos` não existe).

- [ ] **Step 3: Implementar `montarExternos`, busca de títulos e ajustar `lerVendasML`**

Em `supabase/functions/_shared/ml/vendas.ts`:

(a) Adicione um helper de chunk e a montagem (após `agregarPedidos`):

```ts
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Pura: porItemExterno + títulos → lista de ItemExternoVenda ordenada por valor desc. */
export function montarExternos(
  porItemExterno: Record<string, { unidades: number; valor: number }>,
  titulos: Record<string, string>,
): ItemExternoVenda[] {
  return Object.entries(porItemExterno)
    .map(([id, v]) => ({ id, titulo: titulos[id] ?? id, unidades: v.unidades, valor: v.valor }))
    .sort((a, b) => b.valor - a.valor);
}

/** Resolve títulos de N itens via /items em lote (resiliente: bloco que falha vira id). */
async function buscarTitulos(token: string, ids: string[], signal: AbortSignal): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (ids.length === 0) return out;
  const headers = { Authorization: `Bearer ${token}` };
  for (const bloco of chunk(ids, 20)) {
    try {
      const url = `${API}/items?ids=${bloco.join(',')}&attributes=id,title`;
      const resp = await fetch(url, { headers, signal });
      if (!resp.ok) continue;
      const arr = await resp.json(); // [{ code, body:{ id, title } }]
      if (Array.isArray(arr)) {
        for (const e of arr) {
          const id = e?.body?.id;
          if (e?.code === 200 && id) out[id] = e.body.title ?? id;
        }
      }
    } catch { /* bloco indisponível: ids ficam sem título → usa id */ }
  }
  return out;
}
```

(b) Substitua o `return` final de `lerVendasML`:

```ts
  const agg = agregarPedidos(pedidos, escopo);
  const titulos = await buscarTitulos(token, Object.keys(agg.porItemExterno), signal);
  return {
    porItem: agg.porItem,
    totais: agg.totais,
    externos: montarExternos(agg.porItemExterno, titulos),
  };
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `npx vitest run supabase/functions/_shared/ml/__tests__/vendas.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck do backend compartilhado**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `No errors found` (a edge `metricas-vendas` e o conector já repassam o objeto inteiro; `externos` é opcional).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ml/vendas.ts supabase/functions/_shared/ml/__tests__/vendas.test.ts
git commit -m "feat(vendas): lerVendasML resolve títulos e devolve externos"
```

---

### Task 3: Frontend — modelo de período (`Periodo`, `resolverJanela`, params)

**Files:**
- Modify: `src/lib/metricas.ts`
- Create: `src/lib/__tests__/metricas.test.ts`

**Interfaces:**
- Produces: `Periodo`, `Janela`, `resolverJanela(p): Janela`, `periodoToParams(p): Record<string,string>`, `periodoFromParams(get): Periodo`, `buscarMetricasVendas(janela): Promise<MetricasVendas>`, `MetricasVendas.externos?`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/lib/__tests__/metricas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolverJanela, periodoFromParams, periodoToParams } from '../metricas';

describe('resolverJanela', () => {
  it('preset: janela de ~N dias terminando agora', () => {
    const { desde, ate } = resolverJanela({ tipo: 'preset', dias: 30 });
    const delta = new Date(ate).getTime() - new Date(desde).getTime();
    expect(Math.round(delta / 86_400_000)).toBe(30);
  });

  it('range: cobre do início ao fim do dia (local)', () => {
    const { desde, ate } = resolverJanela({ tipo: 'range', desde: '2026-05-01', ate: '2026-05-03' });
    expect(new Date(desde).getTime()).toBe(new Date('2026-05-01T00:00:00').getTime());
    expect(new Date(ate).getTime()).toBe(new Date('2026-05-03T23:59:59.999').getTime());
  });
});

describe('periodo <-> params', () => {
  const mk = (o: Record<string, string>) => (k: string) => o[k] ?? null;

  it('preset ida e volta', () => {
    expect(periodoToParams({ tipo: 'preset', dias: 7 })).toEqual({ dias: '7' });
    expect(periodoFromParams(mk({ dias: '7' }))).toEqual({ tipo: 'preset', dias: 7 });
  });

  it('range ida e volta', () => {
    expect(periodoToParams({ tipo: 'range', desde: '2026-05-01', ate: '2026-05-10' }))
      .toEqual({ de: '2026-05-01', ate: '2026-05-10' });
    expect(periodoFromParams(mk({ de: '2026-05-01', ate: '2026-05-10' })))
      .toEqual({ tipo: 'range', desde: '2026-05-01', ate: '2026-05-10' });
  });

  it('default 30 dias quando ausente ou inválido (de > ate)', () => {
    expect(periodoFromParams(mk({}))).toEqual({ tipo: 'preset', dias: 30 });
    expect(periodoFromParams(mk({ de: '2026-05-10', ate: '2026-05-01' }))).toEqual({ tipo: 'preset', dias: 30 });
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/lib/__tests__/metricas.test.ts`
Expected: FAIL (`resolverJanela`/`periodoFromParams` não existem).

- [ ] **Step 3: Implementar em `src/lib/metricas.ts`**

Substitua o conteúdo de `src/lib/metricas.ts` por:

```ts
import { supabase } from './supabase';

export type PeriodoDias = 7 | 30 | 90;

/** Período selecionado: preset (7/30/90) ou intervalo de datas livre (YYYY-MM-DD). */
export type Periodo =
  | { tipo: 'preset'; dias: PeriodoDias }
  | { tipo: 'range'; desde: string; ate: string };

/** Janela resolvida em ISO 8601 (limites inclusive) para enviar à edge function. */
export interface Janela { desde: string; ate: string }

export interface ItemExternoVenda { id: string; titulo: string; unidades: number; valor: number }

export interface MetricasVendas {
  /** ml_item_id → vendas do período (anúncios do app). */
  porItem: Record<string, { unidades: number; valor: number }>;
  totais: { faturamento: number; unidades: number; pedidos: number };
  /** Itens fora do PubliAI que venderam no período (compõem o total). */
  externos?: ItemExternoVenda[];
  semCredencialML?: boolean;
  /** Falha ao ler /orders do ML (ex.: app sem permissão de Pedidos) — números não confiáveis. */
  erroVendas?: string;
}

/** Calcula a janela ISO a partir do período (preset → agora−dias…agora; range → dia inteiro). */
export function resolverJanela(p: Periodo): Janela {
  if (p.tipo === 'preset') {
    const ate = new Date();
    const desde = new Date(ate.getTime() - p.dias * 24 * 60 * 60 * 1000);
    return { desde: desde.toISOString(), ate: ate.toISOString() };
  }
  const desde = new Date(`${p.desde}T00:00:00`);
  const ate = new Date(`${p.ate}T23:59:59.999`);
  return { desde: desde.toISOString(), ate: ate.toISOString() };
}

/** Serializa o período para query string (?dias=30 ou ?de=…&ate=…). */
export function periodoToParams(p: Periodo): Record<string, string> {
  return p.tipo === 'preset' ? { dias: String(p.dias) } : { de: p.desde, ate: p.ate };
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lê o período de uma fonte de params (ex.: URLSearchParams.get). Default 30 dias. */
export function periodoFromParams(get: (k: string) => string | null): Periodo {
  const de = get('de');
  const ate = get('ate');
  if (de && ate && DATA_RE.test(de) && DATA_RE.test(ate) && de <= ate) {
    return { tipo: 'range', desde: de, ate };
  }
  const dias = Number(get('dias'));
  if (dias === 7 || dias === 30 || dias === 90) return { tipo: 'preset', dias };
  return { tipo: 'preset', dias: 30 };
}

/** Busca as vendas agregadas da janela (edge metricas-vendas). */
export async function buscarMetricasVendas(janela: Janela): Promise<MetricasVendas> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/metricas-vendas`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ desde: janela.desde, ate: janela.ate }),
    },
  );
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as MetricasVendas;
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `npx vitest run src/lib/__tests__/metricas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metricas.ts src/lib/__tests__/metricas.test.ts
git commit -m "feat(metricas): modelo Periodo + resolverJanela + params + externos"
```

---

### Task 4: Frontend — `montarDetalheVendas` (composição pura)

**Files:**
- Create: `src/lib/detalhe-vendas.ts`
- Create: `tests/lib/detalhe-vendas.test.ts`

**Interfaces:**
- Consumes: `MetricasVendas` (Task 3), `PublicadoItem` (`src/lib/publicados.ts`, campos usados: `mlItemId`, `titulo`).
- Produces: `montarDetalheVendas(metricas, publicados): DetalheVendas` com `DetalheVendas { total; pedidos; app: SecaoVendas; externo: SecaoVendas }` e `SecaoVendas { linhas: LinhaVenda[]; unidades; valor; pctTotal }`, `LinhaVenda { id; titulo; unidades; valor; pctTotal }`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/lib/detalhe-vendas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { montarDetalheVendas } from '@/lib/detalhe-vendas';
import type { MetricasVendas } from '@/lib/metricas';
import type { PublicadoItem } from '@/lib/publicados';

const publicados = [
  { mlItemId: 'MLB1', titulo: 'App Item' },
] as unknown as PublicadoItem[];

const metricas: MetricasVendas = {
  porItem: { MLB1: { unidades: 2, valor: 90 } },
  totais: { faturamento: 120, unidades: 5, pedidos: 3 },
  externos: [{ id: 'MLBX', titulo: 'Externo', unidades: 3, valor: 30 }],
};

describe('montarDetalheVendas', () => {
  it('compõe app + externo somando ao total, com % e títulos', () => {
    const r = montarDetalheVendas(metricas, publicados);
    expect(r.total).toBe(120);
    expect(r.pedidos).toBe(3);

    expect(r.app.valor).toBe(90);
    expect(r.app.unidades).toBe(2);
    expect(r.app.linhas[0].titulo).toBe('App Item');
    expect(r.app.linhas[0].pctTotal).toBeCloseTo(75);

    expect(r.externo.valor).toBe(30);
    expect(r.externo.linhas[0].titulo).toBe('Externo');

    expect(r.app.valor + r.externo.valor).toBe(r.total);
  });

  it('usa o id como título quando o anúncio do app não está em publicados', () => {
    const r = montarDetalheVendas(metricas, [] as PublicadoItem[]);
    expect(r.app.linhas[0].titulo).toBe('MLB1');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/lib/detalhe-vendas.test.ts`
Expected: FAIL (`montarDetalheVendas` não existe).

- [ ] **Step 3: Implementar `src/lib/detalhe-vendas.ts`**

```ts
import type { MetricasVendas } from './metricas';
import type { PublicadoItem } from './publicados';

export interface LinhaVenda { id: string; titulo: string; unidades: number; valor: number; pctTotal: number }
export interface SecaoVendas { linhas: LinhaVenda[]; unidades: number; valor: number; pctTotal: number }
export interface DetalheVendas { total: number; pedidos: number; app: SecaoVendas; externo: SecaoVendas }

function secao(linhas: LinhaVenda[], total: number): SecaoVendas {
  const unidades = linhas.reduce((a, l) => a + l.unidades, 0);
  const valor = linhas.reduce((a, l) => a + l.valor, 0);
  return { linhas, unidades, valor, pctTotal: total > 0 ? (valor / total) * 100 : 0 };
}

/** Compõe o detalhe do faturamento: anúncios do app (porItem + títulos) vs. externos. */
export function montarDetalheVendas(metricas: MetricasVendas, publicados: PublicadoItem[]): DetalheVendas {
  const total = metricas.totais.faturamento;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const titulos = new Map(publicados.map((p) => [p.mlItemId, p.titulo]));

  const appLinhas: LinhaVenda[] = Object.entries(metricas.porItem)
    .map(([id, v]) => ({ id, titulo: titulos.get(id) ?? id, unidades: v.unidades, valor: v.valor, pctTotal: pct(v.valor) }))
    .sort((a, b) => b.valor - a.valor);

  const externoLinhas: LinhaVenda[] = (metricas.externos ?? [])
    .map((e) => ({ id: e.id, titulo: e.titulo, unidades: e.unidades, valor: e.valor, pctTotal: pct(e.valor) }))
    .sort((a, b) => b.valor - a.valor);

  return {
    total,
    pedidos: metricas.totais.pedidos,
    app: secao(appLinhas, total),
    externo: secao(externoLinhas, total),
  };
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `npx vitest run tests/lib/detalhe-vendas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/detalhe-vendas.ts tests/lib/detalhe-vendas.test.ts
git commit -m "feat(vendas): montarDetalheVendas (composição app vs externo)"
```

---

### Task 5: Frontend — hook + seletor de período (Personalizado) + card clicável

**Files:**
- Modify: `src/hooks/useMetricasVendas.ts`
- Modify: `src/lib/financeiro.ts` (generalizar para `Janela` — banner compartilha o `periodo`)
- Modify: `src/hooks/useResumoFinanceiro.ts`
- Modify: `src/components/dashboard-publicados.tsx`
- Modify: `src/pages/Publicados.tsx`
- Test: `tests/components/dashboard-publicados.test.tsx` (create)

**Interfaces:**
- Consumes: `Periodo`, `Janela`, `resolverJanela`, `periodoToParams` (Task 3).
- Produces: `useMetricasVendas(janela: Janela)`; `useResumoFinanceiro(janela: Janela)`; `buscarResumoFinanceiro(janela: Janela)`; `DashboardPublicados` props `{ periodo: Periodo; onPeriodo: (p: Periodo) => void; … }`.

> **Contexto do merge do Financeiro (ADR-0031):** `src/pages/Publicados.tsx` agora também chama `useResumoFinanceiro(periodo)` (banner "Líquido das vendas") e ambos os hooks recebiam `PeriodoDias`. Como o `periodo` vira `Periodo`, generalizamos os dois para `Janela`, mantendo o banner coerente com o intervalo personalizado. `buscarResumoFinanceiro` já calcula `desde/ate` no cliente (igual ao antigo `buscarMetricasVendas`) e a edge `resumo-financeiro` já aceita `{ desde, ate }` — a mudança é só de assinatura.

- [ ] **Step 1: Atualizar os hooks de período (metricas + financeiro)**

Substitua `src/hooks/useMetricasVendas.ts` por:

```ts
import { useQuery } from '@tanstack/react-query';
import { buscarMetricasVendas, type MetricasVendas, type Janela } from '@/lib/metricas';

export function useMetricasVendas(janela: Janela) {
  return useQuery<MetricasVendas>({
    queryKey: ['metricasVendas', janela.desde, janela.ate],
    queryFn: () => buscarMetricasVendas(janela),
    staleTime: 5 * 60_000,
  });
}
```

Em `src/lib/financeiro.ts`, troque a assinatura de `buscarResumoFinanceiro` para receber a janela pronta (remova o cálculo `desde/ate` interno):

```ts
import type { Janela } from './metricas';

export async function buscarResumoFinanceiro(janela: Janela): Promise<ResumoFinanceiro> {
  // …mantém a obtenção de sessão existente…
  // remove: const ate = new Date(); const desde = new Date(ate.getTime() - periodoDias * …);
  // usa janela.desde / janela.ate no body:
  //   body: JSON.stringify({ desde: janela.desde, ate: janela.ate }),
  // …mantém o restante (fetch, parse, retorno) igual…
}
```

(Atualize o import de tipo: remova `PeriodoDias` se ficar sem uso; mantenha o corpo do fetch/parse intacto.)

Substitua `src/hooks/useResumoFinanceiro.ts` por:

```ts
import { useQuery } from '@tanstack/react-query';
import { buscarResumoFinanceiro, type ResumoFinanceiro } from '@/lib/financeiro';
import type { Janela } from '@/lib/metricas';

export function useResumoFinanceiro(janela: Janela) {
  return useQuery<ResumoFinanceiro>({
    queryKey: ['resumoFinanceiro', janela.desde, janela.ate],
    queryFn: () => buscarResumoFinanceiro(janela),
    staleTime: 5 * 60_000,
  });
}
```

Nota: `src/pages/Financeiro.tsx` chama `useResumoFinanceiro(periodo)` com `periodo: PeriodoDias` próprio. Ajuste essa chamada para passar a janela resolvida: `const janela = useMemo(() => resolverJanela({ tipo: 'preset', dias: periodo }), [periodo]);` e `useResumoFinanceiro(janela)` (importe `resolverJanela`/`useMemo`). O seletor de presets da página Financeiro permanece igual.

- [ ] **Step 2: Escrever o teste de componente que falha**

Crie `tests/components/dashboard-publicados.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPublicados } from '@/components/dashboard-publicados';
import type { Periodo } from '@/lib/metricas';

// metricas.ts importa supabase (que lança sem env) — mock como nos demais testes.
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

function setup(periodo: Periodo, onPeriodo = vi.fn()) {
  render(
    <MemoryRouter>
      <DashboardPublicados
        itens={[]}
        totais={{ faturamento: 606.8, unidades: 36, pedidos: 24 }}
        periodo={periodo}
        onPeriodo={onPeriodo}
      />
    </MemoryRouter>,
  );
  return { onPeriodo };
}

describe('DashboardPublicados', () => {
  it('o card Faturamento é um link para /publicados/vendas com o período', () => {
    setup({ tipo: 'preset', dias: 30 });
    const link = screen.getByRole('link', { name: /faturamento/i });
    expect(link.getAttribute('href')).toContain('/publicados/vendas');
    expect(link.getAttribute('href')).toContain('dias=30');
  });

  it('ao clicar em Personalizado mostra os campos De/Até', async () => {
    const { onPeriodo } = setup({ tipo: 'preset', dias: 30 });
    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));
    expect(onPeriodo).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'range' }));
  });

  it('no modo range, renderiza os inputs de data', () => {
    setup({ tipo: 'range', desde: '2026-05-01', ate: '2026-05-31' });
    expect(screen.getByLabelText(/de/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/até/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `npx vitest run tests/components/dashboard-publicados.test.tsx`
Expected: FAIL (props antigas `periodo: PeriodoDias`; sem link; sem Personalizado).

- [ ] **Step 4: Implementar `DashboardPublicados`**

Em `src/components/dashboard-publicados.tsx`:

(a) Ajuste imports e tipos no topo:

```tsx
import { Link } from 'react-router-dom';
import { resolverJanela, periodoToParams, type Periodo, type PeriodoDias } from '@/lib/metricas';
```

(b) Substitua a interface `Props` (campos `periodo`/`onPeriodo`):

```tsx
interface Props {
  itens: PublicadoItem[];
  totais: { faturamento: number; unidades: number; pedidos: number };
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  carregando?: boolean;
  aviso?: string | null;
}
```

(c) Logo no início do componente, derive o estado do seletor e a janela default para o modo range:

```tsx
export function DashboardPublicados({ itens, totais, periodo, onPeriodo, carregando, aviso }: Props) {
  const presetAtivo = periodo.tipo === 'preset' ? periodo.dias : null;
  const custom = periodo.tipo === 'range' ? periodo : null;

  const irParaCustom = () => {
    const j = resolverJanela(periodo);
    onPeriodo({ tipo: 'range', desde: j.desde.slice(0, 10), ate: j.ate.slice(0, 10) });
  };

  const queryDetalhe = new URLSearchParams(periodoToParams(periodo)).toString();
  // …resumo (useMemo) e ticket permanecem iguais…
```

(d) Substitua o bloco do seletor de período (os botões 7/30/90) por presets + Personalizado + inputs:

```tsx
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Vendas nos últimos</span>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <Button
              key={p.dias}
              size="sm"
              variant={presetAtivo === p.dias ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs"
              onClick={() => onPeriodo({ tipo: 'preset', dias: p.dias })}
            >
              {p.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={custom ? 'default' : 'outline'}
            className="h-7 px-2.5 text-xs"
            onClick={irParaCustom}
          >
            Personalizado
          </Button>
        </div>
        {custom && (
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="venda-de">De</label>
            <input
              id="venda-de"
              type="date"
              value={custom.desde}
              max={custom.ate}
              onChange={(e) => onPeriodo({ tipo: 'range', desde: e.target.value, ate: custom.ate })}
              className="h-7 rounded-md border bg-background px-2 text-xs"
            />
            <label className="text-xs text-muted-foreground" htmlFor="venda-ate">Até</label>
            <input
              id="venda-ate"
              type="date"
              value={custom.ate}
              min={custom.desde}
              onChange={(e) => onPeriodo({ tipo: 'range', desde: custom.desde, ate: e.target.value })}
              className="h-7 rounded-md border bg-background px-2 text-xs"
            />
          </div>
        )}
        {carregando && <span className="text-xs text-muted-foreground">atualizando…</span>}
      </div>
```

(Mantenha o `PERIODOS` existente. Note que `PeriodoDias` continua importado para tipar `PERIODOS`.)

(e) Torne o card Faturamento um `<Link>`. Substitua o primeiro `<Kpi … label="Faturamento" … />` por:

```tsx
        <Link
          to={{ pathname: '/publicados/vendas', search: queryDetalhe }}
          className="rounded-lg outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
          aria-label="Faturamento — ver composição"
        >
          <Kpi icon={DollarSign} label="Faturamento" valor={fmtBRL(totais.faturamento)} tom="success" />
        </Link>
```

(O `getByRole('link', { name: /faturamento/i })` casa pelo `aria-label`.)

- [ ] **Step 5: Atualizar `Publicados.tsx` para o novo modelo de período**

Em `src/pages/Publicados.tsx`:

(a) Ajuste o import de tipo:

```tsx
import { resolverJanela, type Periodo } from '@/lib/metricas';
import { useMemo } from 'react'; // já importado — garanta que useMemo está no import existente
```

(b) Substitua o estado e as chamadas dos hooks (metricas + financeiro passam a usar `janela`):

```tsx
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  const { data: metricas, isFetching: fetchingMetricas, refetch: refetchMetricas } = useMetricasVendas(janela);
  const { data: financeiro } = useResumoFinanceiro(janela);
```

(c) A passagem de props para `<DashboardPublicados … periodo={periodo} onPeriodo={setPeriodo} … />` já está correta com os novos tipos (sem mudança no JSX). O banner "Líquido das vendas" que consome `financeiro` permanece igual.

- [ ] **Step 6: Rodar testes + typecheck**

Run: `npx vitest run tests/components/dashboard-publicados.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `No errors found`.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useMetricasVendas.ts src/hooks/useResumoFinanceiro.ts src/lib/financeiro.ts src/pages/Financeiro.tsx src/components/dashboard-publicados.tsx src/pages/Publicados.tsx tests/components/dashboard-publicados.test.tsx
git commit -m "feat(publicados): período personalizado + card Faturamento clicável"
```

---

### Task 6: Frontend — página `DetalheVendas` + rota

**Files:**
- Create: `src/pages/DetalheVendas.tsx`
- Modify: `src/App.tsx`
- Test: `tests/pages/detalhe-vendas-page.test.tsx` (create)

**Interfaces:**
- Consumes: `useMetricasVendas`, `usePublicados`, `montarDetalheVendas`, `periodoFromParams`, `resolverJanela`, `fmtBRL`, `fmtInt`.

- [ ] **Step 1: Escrever o teste de página que falha**

Crie `tests/pages/detalhe-vendas-page.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// metricas.ts (importado pela página) puxa supabase, que lança sem env — mock.
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

vi.mock('@/hooks/useMetricasVendas', () => ({
  useMetricasVendas: () => ({
    data: {
      porItem: { MLB1: { unidades: 2, valor: 90.2 } },
      totais: { faturamento: 606.8, unidades: 36, pedidos: 24 },
      externos: [{ id: 'MLBX', titulo: 'Fita Externa', unidades: 5, valor: 62.5 }],
    },
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePublicados', () => ({
  usePublicados: () => ({ data: [{ mlItemId: 'MLB1', titulo: 'LINHA LINHANYL 150' }] }),
}));

import DetalheVendas from '@/pages/DetalheVendas';

describe('DetalheVendas', () => {
  it('mostra total, as duas seções e os títulos', () => {
    render(
      <MemoryRouter initialEntries={['/publicados/vendas?dias=30']}>
        <DetalheVendas />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Detalhe de vendas/i)).toBeInTheDocument();
    expect(screen.getByText(/Seus anúncios/i)).toBeInTheDocument();
    expect(screen.getByText(/Fora do PubliAI/i)).toBeInTheDocument();
    expect(screen.getByText('LINHA LINHANYL 150')).toBeInTheDocument();
    expect(screen.getByText('Fita Externa')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/pages/detalhe-vendas-page.test.tsx`
Expected: FAIL (módulo `../DetalheVendas` não existe).

- [ ] **Step 3: Implementar `src/pages/DetalheVendas.tsx`**

```tsx
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { periodoFromParams, resolverJanela } from '@/lib/metricas';
import { montarDetalheVendas, type SecaoVendas } from '@/lib/detalhe-vendas';
import { useMetricasVendas } from '@/hooks/useMetricasVendas';
import { usePublicados } from '@/hooks/usePublicados';

function pct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function rotuloPeriodo(search: URLSearchParams): string {
  const dias = search.get('dias');
  if (dias) return `últimos ${dias} dias`;
  const de = search.get('de');
  const ate = search.get('ate');
  return de && ate ? `${de} a ${ate}` : 'últimos 30 dias';
}

function SecaoTabela({ titulo, sub, secao }: { titulo: string; sub?: string; secao: SecaoVendas }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
              <TableHead>Título</TableHead>
              <TableHead className="text-right">Unid.</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">% total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {secao.linhas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-4 text-center text-sm text-muted-foreground">
                  Sem vendas no período.
                </TableCell>
              </TableRow>
            ) : (
              secao.linhas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm uppercase">{l.titulo}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{l.unidades}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{fmtBRL(l.valor)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{pct(l.pctTotal)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {secao.linhas.length > 0 && (
            <tfoot>
              <TableRow className="border-t font-medium">
                <TableCell className="text-sm">Subtotal</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{secao.unidades}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{fmtBRL(secao.valor)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{pct(secao.pctTotal)}</TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}

export default function DetalheVendas() {
  const [search] = useSearchParams();
  const periodo = useMemo(() => periodoFromParams((k) => search.get(k)), [search]);
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);

  const { data: metricas, isFetching, refetch } = useMetricasVendas(janela);
  const { data: publicados = [] } = usePublicados();

  const semCred = metricas?.semCredencialML;
  const detalhe = useMemo(
    () => montarDetalheVendas(
      metricas ?? { porItem: {}, totais: { faturamento: 0, unidades: 0, pedidos: 0 } },
      publicados,
    ),
    [metricas, publicados],
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Detalhe de vendas"
        subtitle={`Composição do faturamento — ${rotuloPeriodo(search)}.`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn('mr-1.5 h-4 w-4', isFetching && 'animate-spin')} />
              {isFetching ? 'Atualizando…' : 'Atualizar'}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/publicados"><ArrowLeft className="mr-1.5 h-4 w-4" />Voltar</Link>
            </Button>
          </div>
        }
      />

      {semCred && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Conecte sua conta ML nas Configurações para ver as vendas.
        </div>
      )}
      {metricas?.erroVendas && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {metricas.erroVendas}
        </div>
      )}

      {/* Resumo */}
      <div className="mb-5 rounded-lg border bg-card px-4 py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Faturamento total</span>
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

      <SecaoTabela titulo="Seus anúncios (PubliAI)" secao={detalhe.app} />
      <SecaoTabela titulo="Fora do PubliAI" sub="publicados direto no ML" secao={detalhe.externo} />
    </div>
  );
}
```

- [ ] **Step 4: Registrar a rota em `src/App.tsx`**

Adicione o import (após a linha 14, `import Publicados`):

```tsx
import DetalheVendas from '@/pages/DetalheVendas';
```

E a rota logo após a linha do `/publicados`:

```tsx
          <Route path="/publicados" element={<Publicados />} />
          <Route path="/publicados/vendas" element={<DetalheVendas />} />
```

- [ ] **Step 5: Rodar e confirmar verde**

Run: `npx vitest run tests/pages/detalhe-vendas-page.test.tsx`
Expected: PASS.

- [ ] **Step 6: Suíte completa + typecheck**

Run: `npx vitest run`
Expected: todos PASS.
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `No errors found`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/DetalheVendas.tsx src/App.tsx tests/pages/detalhe-vendas-page.test.tsx
git commit -m "feat(publicados): tela Detalhe de vendas (/publicados/vendas)"
```

---

### Task 7: Deploy + verificação (gated)

**Files:** nenhum (operacional).

> **Pré-requisito (decisão do Diego):** o Financeiro já foi commitado/integrado na `main`. Antes de executar esta task, rebaseie a branch na `main` atualizada e re-rode `npx vitest run` + `npx tsc --noEmit` para garantir que o merge com o banner do Financeiro está limpo. **Não execute o deploy sem confirmação do Diego.**

- [ ] **Step 1: Rebase na main atualizada**

```bash
git fetch origin
git rebase origin/main
npx vitest run && npx tsc --noEmit -p tsconfig.json
```
Expected: rebase limpo (ou conflito só na região do seletor de período em `Publicados.tsx`, resolvível mantendo banner + período); testes/typecheck verdes.

- [ ] **Step 2: Deploy da edge function `metricas-vendas`**

```bash
export SUPABASE_ACCESS_TOKEN=$(grep -E '^SUPABASE_ACCESS_TOKEN=' .env.local | head -1 | cut -d= -f2- | tr -d '"'\'' ')
npx supabase functions deploy metricas-vendas --project-ref txvncrgkoynoxwopfkbp --no-verify-jwt
```
Expected: `Deployed Functions on project …: metricas-vendas`.

- [ ] **Step 3: Verificar o deploy**

Confira (via MCP `get_edge_function` ou dashboard) que a função publicada contém `porItemExterno`/`montarExternos`.

- [ ] **Step 4: Deploy do frontend**

Disparar o deploy do frontend (Render) conforme o fluxo do projeto (`RENDER_DEPLOY_HOOK_FRONTEND`).

- [ ] **Step 5: Verificação manual**

Abrir Publicados → clicar em **Faturamento** → conferir que as duas seções somam o total; testar **Personalizado** com um intervalo e confirmar que cards + tela reconsultam.

---

## Self-Review

**Spec coverage:**
- Composição por anúncio (duas seções, app vs externo, soma ao total) → Tasks 1, 2, 4, 6. ✅
- Intervalo de datas personalizado → Tasks 3, 5. ✅
- Card Faturamento clicável → Task 5. ✅
- Período propagado via URL → Tasks 3 (params) + 5 (link) + 6 (leitura). ✅
- Backend `externos` opcional, dashboard inalterado → Tasks 1, 2. ✅
- Sem libs novas → `<input type="date">` (Task 5). ✅
- Estados de erro (sem credencial, parcial, título ausente) → Tasks 2, 6. ✅
- Pedidos só no total (não por seção) → Task 6 (resumo) / Task 4 (sem pedidos por seção). ✅

**Placeholder scan:** nenhum TBD/TODO; todo passo de código mostra o código. ✅

**Type consistency:** `AgregadoPedidos`/`porItemExterno`/`montarExternos` (Tasks 1–2), `Periodo`/`Janela`/`resolverJanela`/`periodoToParams`/`periodoFromParams` (Task 3), `montarDetalheVendas`/`SecaoVendas`/`LinhaVenda` (Task 4) usados de forma idêntica nas Tasks 5–6. ✅
