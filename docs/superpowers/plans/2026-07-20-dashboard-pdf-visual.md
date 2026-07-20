# Dashboard Visual PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace only the Dashboard PDF export with a clear, two-page A4 landscape visual report that mirrors the Dashboard hierarchy while preserving the existing generic Excel, CSV, print, and non-Dashboard PDF flows.

**Architecture:** Extend `ReportData` with an optional, Dashboard-only discriminated payload assembled from values already computed by `Dashboard.tsx`. Route that payload to a dedicated jsPDF renderer only for PDF; keep the generic renderer as the fallback and as the renderer for print. Keep page-one drawing, page-two/map drawing, and export integration in focused files without introducing a generic layout engine or cartography library.

**Tech Stack:** TypeScript 5.7, React 18, Vitest 3, Testing Library, jsPDF 4.2.1, existing `BRASIL_UF_GEOJSON`, Poppler `pdftoppm`, pnpm 11.

## Global Constraints

- Use strict TDD: add a focused failing test and observe RED before changing production code.
- Do not add a dependency, generic PDF layout engine, cartography library, raster screenshot, canvas capture, `addImage`, or pixel-diff suite.
- The visual renderer is selected only for Dashboard when `formato === 'pdf'`; Dashboard print, Excel, CSV, and all other reports keep their current generic behavior.
- The Dashboard visual PDF is always complete, exactly two A4 landscape pages, and always contains all eight KPIs.
- Hide “Somente os dados” only for the Dashboard PDF path; preserve it for Dashboard Excel, CSV, and print.
- Export exactly the metric selected on screen: `faturamento` and `liquido` use a monetary scale; `pedidos` uses an integer scale; metrics never share an axis.
- Preserve visible KPI delta, trend, and supporting text when present.
- Limit top products to 5, upcoming releases to 6, and geographic ranking to 5 UFs.
- Import `BRASIL_UF_GEOJSON` directly and use a renderer-local pure projection; do not refactor the React map.
- Handle empty series/releases/geography, long product names, negative/null values, and one-point series without overflow or invalid scales.
- Keep all source/test commands prefixed with `rtk`.
- Executors must not undo another agent’s changes and must report every changed file.

---

## File Structure and Ownership

| File | Responsibility | Task / suggested role |
|---|---|---|
| `src/lib/export/tipos.ts` | Dashboard visual payload contract | Task 1 — Luna |
| `src/lib/export/adapters.ts` | Assemble and limit the payload while preserving generic data | Task 1 — Luna |
| `src/lib/export/__tests__/dashboard-adapter.test.ts` | Contract, formatting, limits, optional payload tests | Task 1 — Luna |
| `src/lib/export/pdf-dashboard.ts` | Dedicated renderer entry point, page-one primitives, scale helpers | Task 2 — Terra, then extended by Task 3 owner in a non-overlapping region |
| `src/lib/export/__tests__/pdf-dashboard.test.ts` | Page count, page-one labels, edge cases, no rasterization | Task 2 — Terra, then extended by Task 3 owner |
| `src/lib/export/pdf-dashboard-mapa.ts` | Local GeoJSON projection and vector map/page-two drawing | Task 3 — Terra |
| `src/lib/export/__tests__/pdf-dashboard-mapa.test.ts` | Projection, polygons, ranking and empty geography | Task 3 — Terra |
| `src/lib/export/index.ts` | Select dedicated renderer only for PDF visual payload | Task 4 — Luna |
| `src/components/export/botao-exportar.tsx` | Format-specific KPI-choice visibility | Task 4 — Luna |
| `src/pages/Dashboard.tsx` | Pass selected metric, existing alerts/releases/deltas/subtexts | Task 4 — Luna |
| `src/lib/export/__tests__/index.test.ts` | Dispatcher regression tests | Task 4 — Luna |
| `tests/components/botao-exportar.test.tsx` | Dashboard-PDF-only options behavior | Task 4 — Luna |
| `scripts/fixtures/dashboard-pdf.ts` | Stable representative/empty PDF fixture generator | Task 5 — Luna |
| `docs/superpowers/qa/dashboard-pdf-visual.md` | Reproducible visual QA evidence and observations | Task 5 — Luna |

Task 3 appends page-two integration to the dedicated renderer created in Task 2; it must start only after Task 2 is committed. Tasks 1 and 2 can be reviewed independently but Task 2 consumes Task 1’s types. Task 4 starts after Tasks 1–3. Task 5 starts after Task 4.

## Exact Interfaces

Task 1 must add these exact public types to `src/lib/export/tipos.ts`:

```ts
export type DashboardMetrica = 'faturamento' | 'liquido' | 'pedidos';
export type DashboardTendencia = 'up' | 'down' | 'neutral';

export interface DashboardKpiVisual {
  label: string;
  valor: string;
  delta?: string;
  tendencia?: DashboardTendencia;
  auxiliar?: string;
}

export interface DashboardPontoVisual {
  rotulo: string;
  valor: number | null;
}

export interface DashboardProdutoVisual {
  posicao: number;
  titulo: string;
  unidades: number;
  faturamento: number;
}

export interface DashboardLiberacaoVisual {
  data: string;
  valor: number;
}

export interface DashboardUfVisual {
  uf: string;
  pedidos: number;
  participacao: number;
}

export interface DashboardPdfVisual {
  tipo: 'dashboard';
  periodo: string;
  canal: string;
  metrica: DashboardMetrica;
  serie: DashboardPontoVisual[];
  principais: [DashboardKpiVisual, DashboardKpiVisual];
  secundarios: [
    DashboardKpiVisual,
    DashboardKpiVisual,
    DashboardKpiVisual,
    DashboardKpiVisual,
    DashboardKpiVisual,
    DashboardKpiVisual,
  ];
  alertas: string[];
  produtos: DashboardProdutoVisual[];
  liberacoes: DashboardLiberacaoVisual[];
  geografia: DashboardUfVisual[];
  semLocalizacao: number;
}
```

Add to `ReportData`:

```ts
dashboardPdf?: DashboardPdfVisual;
```

Task 1 must change the Dashboard adapter signature to:

```ts
interface DashboardReportArgs {
  resumo: ResumoVendas;
  kpisPedidos: KpisPedidos;
  serie: PontoSerie[];
  top: ProdutoTop[];
  geografia: GeografiaVendas;
  periodo: Periodo;
  canal: CanalAtivo;
  config: ExportConfig;
  visual?: {
    metrica: DashboardMetrica;
    pontos: DashboardPontoVisual[];
    principais: DashboardPdfVisual['principais'];
    secundarios: DashboardPdfVisual['secundarios'];
    alertas: string[];
    liberacoes: DashboardLiberacaoVisual[];
  };
}
```

The adapter assigns `dashboardPdf` only when `config.formato === 'pdf' && visual`, using:

```ts
dashboardPdf: config.formato === 'pdf' && visual
  ? {
      tipo: 'dashboard',
      periodo: rotuloPeriodo(periodo),
      canal: canal === 'todos' ? 'Todos' : infoCanal(canal)?.nome ?? canal,
      metrica: visual.metrica,
      serie: visual.pontos,
      principais: visual.principais,
      secundarios: visual.secundarios,
      alertas: visual.alertas,
      produtos: top.slice(0, 5).map((produto, index) => ({
        posicao: index + 1,
        titulo: produto.titulo,
        unidades: produto.unidades,
        faturamento: produto.valor,
      })),
      liberacoes: visual.liberacoes.slice(0, 6),
      geografia: geografia.porUf.slice(0, 5).map((item) => ({
        uf: item.uf,
        pedidos: item.pedidos,
        participacao: item.pctPedidos,
      })),
      semLocalizacao: geografia.semGeo,
    }
  : undefined,
```

Task 2 produces:

```ts
export function gerarPdfDashboard(data: DashboardPdfVisual, emitidoEm: Date = new Date()): jsPDF;
export function escalaDashboard(
  valores: Array<number | null>,
  metrica: DashboardMetrica,
): { min: number; max: number; ticks: number[] };
```

Task 3 produces:

```ts
export interface AreaMapa { x: number; y: number; largura: number; altura: number }
export interface PontoMapa { x: number; y: number }
export function projetarMapaBrasil(area: AreaMapa): Map<string, PontoMapa[][][]>;
export function desenharPaginaGeografia(
  doc: jsPDF,
  data: DashboardPdfVisual,
  emitidoEm: Date,
): void;
```

Task 4 extends `BotaoExportarProps` with:

```ts
/** PDF is a fixed complete visual report; other formats keep generic content options. */
pdfSempreCompleto?: boolean;
```

and calls:

```ts
const mostrarOpcaoKpis = temKpis && !(pdfSempreCompleto && formato === 'pdf');
```

## Task 1: Dashboard Visual Payload Contract

**Suggested owner:** Luna — bounded type/adapter work.

**Files:**
- Modify: `src/lib/export/tipos.ts`
- Modify: `src/lib/export/adapters.ts` (Dashboard section only)
- Create: `src/lib/export/__tests__/dashboard-adapter.test.ts`

**Interfaces:**
- Consumes: existing `ResumoVendas`, `KpisPedidos`, `PontoSerie`, `ProdutoTop`, `GeografiaVendas`, `Periodo`, `CanalAtivo`, `ExportConfig`.
- Produces: all exact payload types and `DashboardReportArgs.visual` defined above.

- [ ] **Step 1: Add a failing PDF-only payload test**

Create `src/lib/export/__tests__/dashboard-adapter.test.ts` with a typed factory using minimal valid domain objects and these assertions:

```ts
import { describe, expect, it } from 'vitest';
import { buildDashboardReport } from '../adapters';
import type { DashboardPdfVisual, ExportConfig } from '../tipos';

const pdf: ExportConfig = { formato: 'pdf', expandido: false, incluirKpis: false };
const visual: NonNullable<Parameters<typeof buildDashboardReport>[0]['visual']> = {
  metrica: 'pedidos',
  pontos: [{ rotulo: '20/07', valor: 9 }],
  principais: [
    { label: 'Faturamento bruto', valor: 'R$ 456,56', delta: '+138% vs. anterior', tendencia: 'up', auxiliar: '9 pedidos · 11 unidades' },
    { label: 'Líquido das vendas', valor: 'R$ 319,55', delta: '+133% vs. anterior', tendencia: 'up', auxiliar: 'comissão R$ 52,35 · frete R$ 84,66' },
  ],
  secundarios: [
    { label: 'Líquido no faturamento', valor: 'R$ 276,98' },
    { label: 'Markup no período', valor: '+35%' },
    { label: 'Compradores', valor: '7', auxiliar: '33,3% recompra' },
    { label: 'Pedidos', valor: '9' },
    { label: 'Ticket médio', valor: 'R$ 50,73' },
    { label: 'A receber', valor: 'R$ 319,55', auxiliar: 'próxima em 18/08/2026' },
  ],
  alertas: ['1 lote a revisar'],
  liberacoes: Array.from({ length: 8 }, (_, i) => ({ data: `2026-08-${String(i + 1).padStart(2, '0')}`, valor: i + 1 })),
};

it('anexa payload visual completo somente ao PDF e aplica limites 5/6/5', () => {
  const report = buildDashboardReport(fixtureArgs({ config: pdf, visual, topCount: 7, ufCount: 7 }));
  expect(report.kpis).toHaveLength(8);
  expect(report.dashboardPdf).toMatchObject<Partial<DashboardPdfVisual>>({
    tipo: 'dashboard',
    metrica: 'pedidos',
    alertas: ['1 lote a revisar'],
  });
  expect(report.dashboardPdf?.principais).toEqual(visual.principais);
  expect(report.dashboardPdf?.secundarios).toEqual(visual.secundarios);
  expect(report.dashboardPdf?.produtos).toHaveLength(5);
  expect(report.dashboardPdf?.liberacoes).toHaveLength(6);
  expect(report.dashboardPdf?.geografia).toHaveLength(5);
});

it.each(['excel', 'csv', 'imprimir'] as const)('não anexa payload visual em %s', (formato) => {
  const report = buildDashboardReport(fixtureArgs({
    config: { formato, expandido: false, incluirKpis: true },
    visual,
  }));
  expect(report.dashboardPdf).toBeUndefined();
});
```

Implement `fixtureArgs` in the same test with explicit zero-valued fields required by the imported domain types; do not use `as any`. Populate seven products and seven `porUf` rows so the limits are proven.

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
rtk pnpm test src/lib/export/__tests__/dashboard-adapter.test.ts
```

Expected: TypeScript/Vitest FAIL because `DashboardPdfVisual`, `ReportData.dashboardPdf`, and `DashboardReportArgs.visual` do not exist.

- [ ] **Step 3: Add the exact types**

Add the interfaces from “Exact Interfaces” to `src/lib/export/tipos.ts` and add `dashboardPdf?: DashboardPdfVisual` to `ReportData`. Do not change generic `Kpi`, `Linha`, or `BlocoResumo`.

- [ ] **Step 4: Assemble the payload minimally**

Make `DashboardReportArgs` exported so the test can inspect its parameter type:

```ts
export interface DashboardReportArgs {
  // existing fields unchanged
  visual?: {
    metrica: DashboardMetrica;
    pontos: DashboardPontoVisual[];
    principais: DashboardPdfVisual['principais'];
    secundarios: DashboardPdfVisual['secundarios'];
    alertas: string[];
    liberacoes: DashboardLiberacaoVisual[];
  };
}
```

Import the new types, destructure `visual`, and add the exact conditional `dashboardPdf` expression from “Exact Interfaces”. Keep generic `kpis`, `blocos`, `colunas`, and `linhas` unchanged so Excel/CSV/print remain stable.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
rtk pnpm test src/lib/export/__tests__/dashboard-adapter.test.ts
rtk pnpm exec tsc -b --pretty false
```

Expected: PASS; typecheck has no errors.

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/export/tipos.ts src/lib/export/adapters.ts src/lib/export/__tests__/dashboard-adapter.test.ts
rtk git commit -m "feat: define dashboard visual pdf payload"
```

## Task 2: Page One Renderer and Safe Chart Scale

**Suggested owner:** Terra — deeper jsPDF layout and scale behavior.

**Files:**
- Create: `src/lib/export/pdf-dashboard.ts`
- Create: `src/lib/export/__tests__/pdf-dashboard.test.ts`

**Interfaces:**
- Consumes: `DashboardPdfVisual`, `DashboardMetrica`.
- Produces: `gerarPdfDashboard` and `escalaDashboard` exact signatures above. Task 3 will add page two through `desenharPaginaGeografia`.

- [ ] **Step 1: Write failing scale and page-one tests**

Create `src/lib/export/__tests__/pdf-dashboard.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { escalaDashboard, gerarPdfDashboard } from '../pdf-dashboard';
import { dashboardPdfFixture } from './pdf-dashboard-fixture';

describe('escalaDashboard', () => {
  it('cria escala segura para vazio, nulos e um ponto', () => {
    expect(escalaDashboard([], 'faturamento')).toEqual({ min: 0, max: 1, ticks: [0, 0.5, 1] });
    expect(escalaDashboard([null, 456.56], 'liquido')).toMatchObject({ min: 0 });
    expect(escalaDashboard([9], 'pedidos')).toEqual({ min: 0, max: 9, ticks: [0, 3, 6, 9] });
  });

  it('mantém negativos dentro do domínio e ticks inteiros para pedidos', () => {
    expect(escalaDashboard([-20, 40], 'faturamento')).toMatchObject({ min: -20, max: 40 });
    expect(escalaDashboard([-2, 3], 'pedidos').ticks.every(Number.isInteger)).toBe(true);
  });
});

it('gera duas páginas A4 paisagem com os oito KPIs e a métrica selecionada', () => {
  const data = dashboardPdfFixture();
  const doc = gerarPdfDashboard(data, new Date('2026-07-20T10:31:00-03:00'));
  expect(doc.getNumberOfPages()).toBe(2);
  expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight());
  const pdf = doc.output();
  for (const texto of ['Dashboard', 'Faturamento bruto', 'Líquido das vendas', 'Evolução de vendas', 'Top produtos do período']) {
    expect(pdf).toContain(texto);
  }
});

it('não rasteriza o relatório', () => {
  const addImage = vi.spyOn(Object.getPrototypeOf(gerarPdfDashboard(dashboardPdfFixture())), 'addImage');
  gerarPdfDashboard(dashboardPdfFixture());
  expect(addImage).not.toHaveBeenCalled();
  addImage.mockRestore();
});
```

Create the colocated `src/lib/export/__tests__/pdf-dashboard-fixture.ts` exporting a complete `dashboardPdfFixture(overrides?: Partial<DashboardPdfVisual>): DashboardPdfVisual` with the representative values from Task 1. This is a test helper, not the Task 5 CLI fixture.

- [ ] **Step 2: Run the test and confirm RED**

```bash
rtk pnpm test src/lib/export/__tests__/pdf-dashboard.test.ts
```

Expected: FAIL because `pdf-dashboard.ts` and its exports do not exist.

- [ ] **Step 3: Implement safe scale calculation**

Use this complete minimum algorithm:

```ts
export function escalaDashboard(
  valores: Array<number | null>,
  metrica: DashboardMetrica,
): { min: number; max: number; ticks: number[] } {
  const validos = valores.filter((valor): valor is number => Number.isFinite(valor));
  if (validos.length === 0) return { min: 0, max: 1, ticks: [0, 0.5, 1] };
  const menor = Math.min(0, ...validos);
  const maior = Math.max(0, ...validos);
  if (metrica === 'pedidos') {
    const max = Math.max(1, Math.ceil(maior));
    const min = Math.floor(menor);
    const passo = Math.max(1, Math.ceil((max - min) / 3));
    const ticks = Array.from({ length: 4 }, (_, i) => Math.min(max, min + passo * i));
    ticks[ticks.length - 1] = max;
    return { min, max, ticks: [...new Set(ticks)] };
  }
  if (menor === maior) return { min: Math.min(0, menor), max: maior === 0 ? 1 : maior, ticks: [0, maior / 2, maior] };
  return { min: menor, max: maior, ticks: [menor, menor + (maior - menor) / 2, maior] };
}
```

- [ ] **Step 4: Implement page-one primitives and entry point**

In `pdf-dashboard.ts`, define fixed millimetre coordinates for A4 landscape (`297 × 210`, margin `12`) and small private functions:

```ts
function desenharCabecalho(doc: jsPDF, data: DashboardPdfVisual, emitidoEm: Date): void;
function desenharKpi(doc: jsPDF, kpi: DashboardKpiVisual, x: number, y: number, w: number, h: number, destaque: boolean): void;
function desenharAlertas(doc: jsPDF, alertas: string[], y: number): number;
function desenharGrafico(doc: jsPDF, data: DashboardPdfVisual, x: number, y: number, w: number, h: number): void;
function desenharProdutos(doc: jsPDF, produtos: DashboardProdutoVisual[], x: number, y: number, w: number, h: number): void;
```

Use `doc.roundedRect`, `doc.line`, `doc.lines`, `doc.circle`, and `doc.text` only. For truncation, use:

```ts
function truncar(doc: jsPDF, texto: string, largura: number): string {
  if (doc.getTextWidth(texto) <= largura) return texto;
  let corte = texto;
  while (corte.length > 1 && doc.getTextWidth(`${corte}…`) > largura) corte = corte.slice(0, -1);
  return `${corte.trimEnd()}…`;
}
```

For an empty series draw `Sem vendas no período`. Otherwise map each finite point to the plot rectangle using `escalaDashboard`; one point must draw a visible `doc.circle`. Format money ticks with `fmtBRL` and pedido ticks with `fmtInt`. Draw the zero line when `min < 0`.

Lay out page one at these stable bounds:

- header `x=12, y=12, w=273, h=14`;
- hero cards `y=31`, two columns, `h=28`;
- six secondary cards `y=63`, three columns × two rows, `h=18`;
- optional attention strip starting `y=103`, maximum one line, each label truncated;
- chart card `x=12, y=116, w=174, h=78`;
- products card `x=190, y=116, w=95, h=78`, maximum five rows.

The entry point must always create page two, initially blank for the RED-to-GREEN boundary of this task:

```ts
export function gerarPdfDashboard(data: DashboardPdfVisual, emitidoEm = new Date()): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  desenharCabecalho(doc, data, emitidoEm);
  // draw page one sections at the fixed bounds above
  doc.addPage('a4', 'landscape');
  return doc;
}
```

- [ ] **Step 5: Run focused test and inspect logical output**

```bash
rtk pnpm test src/lib/export/__tests__/pdf-dashboard.test.ts
rtk pnpm exec tsc -b --pretty false
```

Expected: PASS; two pages, page-one labels, safe scales, and no `addImage`.

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/export/pdf-dashboard.ts src/lib/export/__tests__/pdf-dashboard.test.ts src/lib/export/__tests__/pdf-dashboard-fixture.ts
rtk git commit -m "feat: render dashboard pdf executive page"
```

## Task 3: Vector Brazil Map and Page Two

**Suggested owner:** Terra — GeoJSON projection and vector drawing.

**Files:**
- Create: `src/lib/export/pdf-dashboard-mapa.ts`
- Create: `src/lib/export/__tests__/pdf-dashboard-mapa.test.ts`
- Modify: `src/lib/export/pdf-dashboard.ts` (only import/call page-two function)
- Modify: `src/lib/export/__tests__/pdf-dashboard.test.ts` (only page-two assertions)

**Interfaces:**
- Consumes: `DashboardPdfVisual`, `BRASIL_UF_GEOJSON`, page-two jsPDF instance.
- Produces: `projetarMapaBrasil` and `desenharPaginaGeografia` exact signatures above.

- [ ] **Step 1: Write failing projection and page-two tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import { desenharPaginaGeografia, projetarMapaBrasil } from '../pdf-dashboard-mapa';
import { dashboardPdfFixture } from './pdf-dashboard-fixture';

it('projeta as 27 UFs dentro da área solicitada', () => {
  const area = { x: 12, y: 52, largura: 125, altura: 128 };
  const ufs = projetarMapaBrasil(area);
  expect(ufs.size).toBe(27);
  for (const polygons of ufs.values()) {
    for (const rings of polygons) for (const ring of rings) for (const p of ring) {
      expect(p.x).toBeGreaterThanOrEqual(area.x);
      expect(p.x).toBeLessThanOrEqual(area.x + area.largura);
      expect(p.y).toBeGreaterThanOrEqual(area.y);
      expect(p.y).toBeLessThanOrEqual(area.y + area.altura);
    }
  }
});

it('desenha mapa, ranking limitado e liberações sem imagem', () => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const addImage = vi.spyOn(doc, 'addImage');
  desenharPaginaGeografia(doc, dashboardPdfFixture(), new Date('2026-07-20T10:31:00-03:00'));
  const output = doc.output();
  expect(output).toContain('Liberações próximas');
  expect(output).toContain('Vendas por estado');
  expect(output).toContain('Página 2 de 2');
  expect(addImage).not.toHaveBeenCalled();
});

it.each([
  { patch: { liberacoes: [] }, texto: 'Nada a liberar no horizonte' },
  { patch: { geografia: [] }, texto: 'Sem vendas com destino no período' },
])('desenha estado vazio: $texto', ({ patch, texto }) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  desenharPaginaGeografia(doc, dashboardPdfFixture(patch), new Date('2026-07-20T10:31:00-03:00'));
  expect(doc.output()).toContain(texto);
});
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
rtk pnpm test src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
```

Expected: FAIL because `pdf-dashboard-mapa.ts` does not exist.

- [ ] **Step 3: Implement local equirectangular projection**

Port only the bounding-box and aspect correction already present in `mapa-brasil.tsx`. Compute global bounds across `BRASIL_UF_GEOJSON.features`, use `k = cos(midLat)`, preserve aspect ratio inside `AreaMapa`, center the result, and return projected rings grouped by UF. Do not generate SVG path strings and do not modify the React component.

The coordinate transform must be:

```ts
const naturalW = (maxLng - minLng) * k;
const naturalH = maxLat - minLat;
const scale = Math.min(area.largura / naturalW, area.altura / naturalH);
const offsetX = area.x + (area.largura - naturalW * scale) / 2;
const offsetY = area.y + (area.altura - naturalH * scale) / 2;
const project = (lng: number, lat: number): PontoMapa => ({
  x: offsetX + (lng - minLng) * k * scale,
  y: offsetY + (maxLat - lat) * scale,
});
```

- [ ] **Step 4: Draw page two with vector primitives**

Implement:

- compact header at `x=12, y=12`;
- releases card `x=12, y=29, w=273, h=23`, maximum six entries in a single row or the explicit empty message;
- geography card `x=12, y=56, w=273, h=134`;
- map area `x=20, y=65, w=122, h=110`;
- gradient legend below the map using a sequence of 20 narrow filled rectangles, not an image;
- ranking `x=158, y=78, w=116`, maximum five rows with UF, bar, pedidos, and percentage;
- footer at `y=201` with page, period, channel, and emission.

For each projected ring, convert points after the first into relative vectors and call:

```ts
doc.lines(
  ring.slice(1).map((p, i) => [p.x - ring[i].x, p.y - ring[i].y] as [number, number]),
  ring[0].x,
  ring[0].y,
  [1, 1],
  'FD',
  true,
);
```

Choose fill intensity from `pedidos / maxPedidos`, with zero-sales states in light gray and sales states in violet. Set stroke to a visible light-gray border. Use `Math.max(1, ...data.geografia.map(g => g.pedidos))` to avoid division by zero.

- [ ] **Step 5: Connect page two and strengthen entry-point test**

Import `desenharPaginaGeografia` into `pdf-dashboard.ts` and call it immediately after `doc.addPage('a4', 'landscape')`.

Extend `pdf-dashboard.test.ts` to assert page-two labels and all three empty states. Keep the structural `addImage` spy covering the complete renderer.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
rtk pnpm test src/lib/export/__tests__/pdf-dashboard.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
rtk pnpm exec tsc -b --pretty false
```

Expected: PASS with exactly two pages and no type errors.

- [ ] **Step 7: Commit**

```bash
rtk git add src/lib/export/pdf-dashboard.ts src/lib/export/pdf-dashboard-mapa.ts src/lib/export/__tests__/pdf-dashboard.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
rtk git commit -m "feat: render dashboard pdf geography page"
```

## Task 4: PDF-Only Routing, Dashboard Data, and Export Options UX

**Suggested owner:** Luna — bounded integration and UI behavior.

**Files:**
- Modify: `src/lib/export/index.ts`
- Modify: `src/components/export/botao-exportar.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Create: `src/lib/export/__tests__/index.test.ts`
- Create: `tests/components/botao-exportar.test.tsx`

**Interfaces:**
- Consumes: Task 1 payload and Task 2 `gerarPdfDashboard`.
- Produces: PDF-only routing and `pdfSempreCompleto?: boolean`.

- [ ] **Step 1: Write failing dispatcher tests**

Mock both renderer modules and browser download behavior:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardPdfFixture } from './pdf-dashboard-fixture';

const visual = vi.fn(() => ({ save: vi.fn() }));
const generico = vi.fn(() => ({ save: vi.fn(), output: vi.fn(() => new Blob()) }));
vi.mock('../pdf-dashboard', () => ({ gerarPdfDashboard: visual }));
vi.mock('../pdf', () => ({ gerarPdf: generico }));

describe('exportar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa renderer visual somente para Dashboard PDF com payload', async () => {
    const { exportar } = await import('../index');
    await exportar(reportFixture({ dashboardPdf: dashboardPdfFixture() }), 'pdf');
    expect(visual).toHaveBeenCalledOnce();
    expect(generico).not.toHaveBeenCalled();
  });

  it.each(['imprimir', 'pdf'] as const)('usa renderer genérico em %s sem seleção visual aplicável', async (formato) => {
    const { exportar } = await import('../index');
    const report = formato === 'imprimir'
      ? reportFixture({ dashboardPdf: dashboardPdfFixture() })
      : reportFixture();
    await exportar(report, formato);
    expect(generico).toHaveBeenCalledOnce();
    expect(visual).not.toHaveBeenCalled();
  });
});
```

Stub `window.open`, `URL.createObjectURL`, and `URL.revokeObjectURL` for the print case. `reportFixture` must return a valid generic `ReportData`.

- [ ] **Step 2: Write failing component test for format-specific option**

In `tests/components/botao-exportar.test.tsx`, render `BotaoExportar` with `temKpis pdfSempreCompleto`, open each menu format with `userEvent`, and assert:

```ts
expect(screen.queryByText('Somente os dados')).not.toBeInTheDocument(); // PDF dialog
expect(screen.getByText('Somente os dados')).toBeInTheDocument(); // Excel dialog
expect(screen.getByText('Somente os dados')).toBeInTheDocument(); // CSV dialog
expect(screen.getByText('Somente os dados')).toBeInTheDocument(); // impressão dialog
```

Also confirm PDF submission calls `montarReport` with:

```ts
{ formato: 'pdf', expandido: false, incluirKpis: true }
```

- [ ] **Step 3: Run both tests and confirm RED**

```bash
rtk pnpm test src/lib/export/__tests__/index.test.ts tests/components/botao-exportar.test.tsx
```

Expected: FAIL because the dispatcher always calls `gerarPdf` and `pdfSempreCompleto` does not exist.

- [ ] **Step 4: Implement the smallest dispatcher branch**

In `exportar`, before importing the generic renderer:

```ts
if (formato === 'pdf' && data.dashboardPdf?.tipo === 'dashboard') {
  const { gerarPdfDashboard } = await import('./pdf-dashboard');
  gerarPdfDashboard(data.dashboardPdf).save(nomeArquivo(data.titulo, 'pdf'));
  return;
}
```

Do not change Excel, CSV, generic PDF, or print branches.

- [ ] **Step 5: Implement the format-specific options behavior**

Add `pdfSempreCompleto = false` to props. Use:

```ts
const mostrarOpcaoKpis = temKpis && !(pdfSempreCompleto && formato === 'pdf');
const incluirKpisEfetivo = pdfSempreCompleto && formato === 'pdf' ? true : incluirKpis;
```

Render the content radio only when `mostrarOpcaoKpis`, and pass `incluirKpisEfetivo` from `confirmar`. Do not bypass the confirmation dialog, because it retains consistent generation feedback.

- [ ] **Step 6: Pass existing Dashboard values without new state/query**

Add `pdfSempreCompleto` to the Dashboard button and construct `visual` only when `config.formato === 'pdf'`.

Use the existing state/calculations:

```ts
const pontosPdf = serieGrafico.map((p) => ({
  rotulo: p.rotulo,
  valor: metrica === 'pedidos' ? p.pedidos : p.liquido,
}));
```

Pass `principais` and `secundarios` as the exact tuples from Task 1, formatted with existing `fmtBRL`, `fmtInt`, `delta`, `formatProximaLiberacao`, `r`, `rAnt`, `kpisPedidos`, `kpisPedidosAnt`, `mostrarLucro`, and `devolucoesPeriodo`. Pass:

```ts
alertas: atencao.map((item) => item.label),
liberacoes: caixa.map((item) => ({ data: fmtDia(item.data), valor: item.total })),
```

Do not add hooks, queries, polling, or component state.

- [ ] **Step 7: Run integration tests, typecheck, and directed lint**

```bash
rtk pnpm test src/lib/export/__tests__/dashboard-adapter.test.ts src/lib/export/__tests__/index.test.ts tests/components/botao-exportar.test.tsx
rtk pnpm exec tsc -b --pretty false
rtk pnpm exec eslint src/lib/export/tipos.ts src/lib/export/adapters.ts src/lib/export/index.ts src/lib/export/pdf-dashboard.ts src/lib/export/pdf-dashboard-mapa.ts src/components/export/botao-exportar.tsx src/pages/Dashboard.tsx src/lib/export/__tests__/dashboard-adapter.test.ts src/lib/export/__tests__/index.test.ts src/lib/export/__tests__/pdf-dashboard.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts tests/components/botao-exportar.test.tsx
```

Expected: PASS with no errors.

- [ ] **Step 8: Commit**

```bash
rtk git add src/lib/export/index.ts src/components/export/botao-exportar.tsx src/pages/Dashboard.tsx src/lib/export/__tests__/index.test.ts tests/components/botao-exportar.test.tsx
rtk git commit -m "feat: route dashboard pdf visual export"
```

## Task 5: Stable PDF Fixture and Visual QA

**Suggested owner:** Luna — bounded fixture and artifact validation.

**Files:**
- Create: `scripts/fixtures/dashboard-pdf.ts`
- Create: `docs/superpowers/qa/dashboard-pdf-visual.md`

**Interfaces:**
- Consumes: `gerarPdfDashboard`, `DashboardPdfVisual`.
- Produces: reproducible PDFs under `tmp/pdfs/` and rendered PNG evidence.

- [ ] **Step 1: Write the fixture generator**

Create a Node-compatible TypeScript script with a fixed `emitidoEm` and two payloads:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { gerarPdfDashboard } from '../../src/lib/export/pdf-dashboard';
import type { DashboardPdfVisual } from '../../src/lib/export/tipos';

const representativo: DashboardPdfVisual = {
  tipo: 'dashboard',
  periodo: 'Hoje',
  canal: 'Todos',
  metrica: 'faturamento',
  serie: [{ rotulo: '20/07', valor: 456.56 }],
  principais: [
    { label: 'Faturamento bruto', valor: 'R$ 456,56', delta: '+138% vs. anterior', tendencia: 'up', auxiliar: '9 pedidos · 11 unidades' },
    { label: 'Líquido das vendas', valor: 'R$ 319,55', delta: '+133% vs. anterior', tendencia: 'up', auxiliar: 'comissão R$ 52,35 · frete R$ 84,66' },
  ],
  secundarios: [
    { label: 'Líquido no faturamento', valor: 'R$ 276,98', delta: '+139% vs. anterior', tendencia: 'up' },
    { label: 'Markup no período', valor: '+35%', tendencia: 'up' },
    { label: 'Compradores', valor: '7', auxiliar: '33,3% recompra' },
    { label: 'Pedidos', valor: '9', delta: '+125% vs. anterior', tendencia: 'up' },
    { label: 'Ticket médio', valor: 'R$ 50,73', delta: '+6% vs. anterior', tendencia: 'up' },
    { label: 'A receber', valor: 'R$ 319,55', auxiliar: 'próxima em 18/08/2026' },
  ],
  alertas: ['1 lote a revisar', '1 anúncio com problema', '1 devolução aberta'],
  produtos: [
    { posicao: 1, titulo: 'Tecido Oxford Liso 10m | 100% Poliéster | Qualidade Premium', unidades: 5, faturamento: 280.8 },
    { posicao: 2, titulo: 'Cola Em Bastão 11mm Grossa 1kg | Adesão Firme', unidades: 2, faturamento: 75.8 },
    { posicao: 3, titulo: 'Linha Charme Círculo 150gr Crochê Tricô 100% Algodão 396mts Cor Camafeu 3201 - título deliberadamente longo', unidades: 3, faturamento: 74.97 },
    { posicao: 4, titulo: 'Fio Charme Círculo 150g | 100% Algodão Mercerizado', unidades: 1, faturamento: 24.99 },
  ],
  liberacoes: [{ data: '18/08', valor: 319.55 }],
  geografia: [
    { uf: 'MG', pedidos: 4, participacao: 44.4 },
    { uf: 'TO', pedidos: 1, participacao: 11.1 },
    { uf: 'BA', pedidos: 1, participacao: 11.1 },
    { uf: 'MT', pedidos: 1, participacao: 11.1 },
    { uf: 'SC', pedidos: 1, participacao: 11.1 },
  ],
  semLocalizacao: 1,
};

const vazio: DashboardPdfVisual = {
  ...representativo,
  metrica: 'pedidos',
  serie: [],
  alertas: [],
  produtos: [],
  liberacoes: [],
  geografia: [],
  semLocalizacao: 0,
};

mkdirSync('tmp/pdfs', { recursive: true });
for (const [nome, data] of Object.entries({ representativo, vazio })) {
  const doc = gerarPdfDashboard(data, new Date('2026-07-20T10:31:00-03:00'));
  writeFileSync(`tmp/pdfs/dashboard-${nome}.pdf`, Buffer.from(doc.output('arraybuffer')));
}
```

If the repo cannot execute TypeScript directly, use the already installed Vite/Vitest transform through a dedicated `vitest run` fixture test that writes the files; do not add `tsx` or another dependency.

- [ ] **Step 2: Generate both PDFs**

Run the fixture through the existing toolchain selected in Step 1, for example:

```bash
rtk pnpm exec vite-node scripts/fixtures/dashboard-pdf.ts
```

Expected: `tmp/pdfs/dashboard-representativo.pdf` and `tmp/pdfs/dashboard-vazio.pdf` exist, each with exactly two pages.

- [ ] **Step 3: Confirm PDF structure**

```bash
rtk proxy pdfinfo tmp/pdfs/dashboard-representativo.pdf
rtk proxy pdfinfo tmp/pdfs/dashboard-vazio.pdf
```

Expected for both: `Pages: 2`, `Page size: 841.89 x 595.28 pts (A4)`.

- [ ] **Step 4: Render pages to PNG**

```bash
rtk proxy mkdir -p tmp/pdfs/rendered
rtk proxy pdftoppm -png -r 150 tmp/pdfs/dashboard-representativo.pdf tmp/pdfs/rendered/dashboard-representativo
rtk proxy pdftoppm -png -r 150 tmp/pdfs/dashboard-vazio.pdf tmp/pdfs/rendered/dashboard-vazio
rtk ls tmp/pdfs/rendered
```

Expected: four PNG files, pages 1 and 2 for each fixture.

- [ ] **Step 5: Inspect all four PNGs**

Open each image with the workspace image viewer and explicitly check:

- no third page, clipping, overlap, or text crossing a card/footer;
- eight KPIs and selected metric visible on page one;
- long product title ends in an ellipsis and leaves units/value readable;
- one-point marker and safe axis visible;
- releases, Brazil map, five bars, percentages, and `sem localização` note visible on page two;
- empty messages visible and centered in the empty fixture;
- light background, violet hierarchy, green only for positive financial values, amber attention strip;
- map borders and chart line remain crisp at 150 DPI.

Record pass/fail for each item in `docs/superpowers/qa/dashboard-pdf-visual.md`, including the exact fixture timestamp and commands. If any item fails, return the task to the owning renderer task, add a failing logical test where possible, fix minimally, regenerate, and re-inspect.

- [ ] **Step 6: Run global verification**

```bash
rtk pnpm test src/lib/export/__tests__/dashboard-adapter.test.ts src/lib/export/__tests__/pdf-dashboard.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts src/lib/export/__tests__/index.test.ts tests/components/botao-exportar.test.tsx
rtk pnpm exec tsc -b --pretty false
rtk pnpm exec eslint src/lib/export src/components/export/botao-exportar.tsx src/pages/Dashboard.tsx tests/components/botao-exportar.test.tsx scripts/fixtures/dashboard-pdf.ts
rtk pnpm test
```

Expected: all targeted tests PASS, TypeScript and directed ESLint report no errors, and the complete test suite passes.

- [ ] **Step 7: Clean intermediate PNGs and commit fixture/evidence**

Keep the PDFs temporarily for final review but remove rendered intermediates:

```bash
rtk proxy rm -rf tmp/pdfs/rendered
rtk git add scripts/fixtures/dashboard-pdf.ts docs/superpowers/qa/dashboard-pdf-visual.md
rtk git commit -m "test: verify dashboard visual pdf"
```

Do not commit `tmp/pdfs/` artifacts.

## Final Whole-Branch Review

- [ ] Review the complete diff against `docs/superpowers/specs/2026-07-20-dashboard-pdf-visual-design.md`.
- [ ] Confirm `src/lib/export/pdf.ts`, Excel, and CSV implementations have no visual changes.
- [ ] Confirm no production or test code invokes `addImage`.
- [ ] Confirm no new dependency or generic abstraction was introduced.
- [ ] Re-run the global verification commands from Task 5.
- [ ] Regenerate and inspect the representative and empty PDFs after the final integrated commit.

## Plan Self-Review

### Spec coverage

| Specification requirement | Implemented by |
|---|---|
| Dedicated Dashboard payload without new query/state | Tasks 1 and 4 |
| Clear visual hierarchy, eight KPIs, deltas/subtexts | Tasks 2 and 4 |
| Single selected metric with compatible scale | Tasks 2 and 4 |
| Alerts, top five, six releases | Tasks 1–4 |
| Vector map, top five UFs, percentage, no `addImage` | Task 3 |
| Exactly two A4 landscape pages | Tasks 2–3 |
| Empty states, negative/null/one-point scale, long text | Tasks 2–3 and 5 |
| PDF-only visual routing; generic print/Excel/CSV unchanged | Tasks 1 and 4 |
| PDF always complete; format-specific options UX | Task 4 |
| Stable fixture, Poppler render, visual inspection | Task 5 |
| Targeted tests, TypeScript, directed lint, full suite | Tasks 1–5 |

No specification gap remains.

### Placeholder scan

The plan was checked for prohibited placeholder markers, deferred implementation language, unspecified error handling, and unbound function/type names. No implementation placeholder remains. The fixture runner has one evidence-based branch because actual runner availability must be verified at execution time; both allowed implementations prohibit a new dependency.

### Type consistency

- `DashboardPdfVisual`, `DashboardMetrica`, tuples, point/product/release/UF types are defined once in Task 1 and consumed unchanged in Tasks 2–5.
- `gerarPdfDashboard(data, emitidoEm?)` is produced in Task 2 and consumed with the same signature in Tasks 4–5.
- `desenharPaginaGeografia(doc, data, emitidoEm)` is produced and consumed in Task 3.
- `pdfSempreCompleto?: boolean` is produced and consumed only in Task 4.
- `participacao`, `semLocalizacao`, and `valor` property names remain consistent from adapter through renderer and fixture.

### Gaps found and corrected during self-review

- The first decomposition risked overlapping ownership of `pdf-dashboard.ts`; Task 3 is now explicitly sequential and limited to importing/calling page two.
- The generic content radio originally conflicted with fixed complete PDF output; Task 4 now hides it only for Dashboard PDF and forces `incluirKpis: true`.
- Visual PNG inspection alone did not prove vector output; Tasks 2–3 now spy on `addImage` across the complete renderer.
- Unbounded arrays could break fixed pagination; Task 1 enforces 5/6/5 before rendering.
