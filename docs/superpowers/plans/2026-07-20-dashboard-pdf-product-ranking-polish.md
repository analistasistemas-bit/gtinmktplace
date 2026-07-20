# Dashboard PDF Product and Ranking Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alinhar os itens de Top produtos e compartilhar a intensidade cromática entre mapa e barras do ranking por UF.

**Architecture:** Manter os renderers atuais. O card de produtos reservará uma coluna fixa à direita para faturamento; o renderer geográfico ganhará uma função local pura que calcula a cor pela proporção de pedidos e será usada por mapa e ranking.

**Tech Stack:** TypeScript, jsPDF, Vitest, Poppler.

## Global Constraints

- Manter duas páginas A4 paisagem.
- Não alterar payload, limites, tela do Dashboard ou outros formatos.
- Não adicionar dependências, rasterização ou abstração genérica.
- Validar os cenários representativo e vazio por PNG.

---

### Task 1: Corrigir alinhamento e escala cromática

**Files:**
- Modify: `src/lib/export/pdf-dashboard.ts`
- Modify: `src/lib/export/pdf-dashboard-mapa.ts`
- Modify: `src/lib/export/__tests__/pdf-dashboard.test.ts`
- Modify: `src/lib/export/__tests__/pdf-dashboard-mapa.test.ts`

**Interfaces:**
- Consumes: `DashboardProdutoVisual`, `DashboardPdfVisual` e a constante local `VIOLETA`.
- Produces: `corPorIntensidade(pedidos: number, maxPedidos: number): [number, number, number]`, usada apenas no renderer geográfico.

- [ ] **Step 1: Escrever testes que reproduzem os defeitos**

No teste de produtos, espionar `doc.text` e provar que os cinco faturamentos usam
o mesmo `x` com `{ align: 'right' }`, enquanto o título termina antes da coluna.

No teste geográfico, exportar `corPorIntensidade` e afirmar:

```ts
expect(corPorIntensidade(100, 100)).toEqual([124, 58, 237]);
expect(corPorIntensidade(25, 100)).not.toEqual(corPorIntensidade(100, 100));
expect(corPorIntensidade(25, 100).every((canal, i) =>
  canal >= corPorIntensidade(100, 100)[i],
)).toBe(true);
```

- [ ] **Step 2: Executar RED**

```bash
rtk pnpm exec vitest run src/lib/export/__tests__/pdf-dashboard.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
```

Esperado: falha porque o faturamento ainda está na segunda linha e a função de
cor compartilhada ainda não existe.

- [ ] **Step 3: Implementar o layout mínimo de produtos**

Em `desenharProdutos`, reservar a coluna final:

```ts
const valorX = x + w - 5;
const tituloW = w - 48;
doc.text(`${produto.posicao}. ${truncar(doc, produto.titulo, tituloW)}`, x + 5, ry);
doc.text(fmtBRL(produto.faturamento), valorX, ry, { align: 'right' });
doc.text(`${fmtInt(produto.unidades)} un.`, x + 5, ry + 4);
```

O faturamento fica na linha principal, e unidades permanecem abaixo do título.

- [ ] **Step 4: Implementar uma única escala cromática**

Em `pdf-dashboard-mapa.ts`:

```ts
export function corPorIntensidade(
  pedidos: number,
  maxPedidos: number,
): [number, number, number] {
  const intensidade = Math.max(0, Math.min(1, pedidos / Math.max(1, maxPedidos)));
  const mistura = 0.18 + intensidade * 0.82;
  return [
    Math.round(255 + (VIOLETA[0] - 255) * mistura),
    Math.round(255 + (VIOLETA[1] - 255) * mistura),
    Math.round(255 + (VIOLETA[2] - 255) * mistura),
  ];
}
```

Usar `corPorIntensidade(pedidos, maxPedidos)` tanto no preenchimento dos estados
quanto no preenchimento de cada barra do ranking.

- [ ] **Step 5: Executar GREEN e validações estáticas**

```bash
rtk pnpm exec vitest run src/lib/export/__tests__/pdf-dashboard.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
rtk pnpm exec tsc -b --pretty false
rtk pnpm exec eslint src/lib/export/pdf-dashboard.ts src/lib/export/pdf-dashboard-mapa.ts src/lib/export/__tests__/pdf-dashboard.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
rtk git diff --check
```

Esperado: todos os comandos passam.

- [ ] **Step 6: Gerar e inspecionar os PDFs**

```bash
rtk pnpm exec vitest run tests/dashboard-pdf.fixture.test.ts
rtk proxy pdfinfo tmp/pdfs/dashboard-representativo.pdf
rtk proxy pdfinfo tmp/pdfs/dashboard-vazio.pdf
rtk proxy pdftoppm -png -r 150 tmp/pdfs/dashboard-representativo.pdf tmp/pdfs/polish-representativo
rtk proxy pdftoppm -png -r 150 tmp/pdfs/dashboard-vazio.pdf tmp/pdfs/polish-vazio
```

Esperado: dois PDFs com duas páginas A4 paisagem; produtos alinhados; barras com
tons progressivos iguais aos respectivos estados; estados vazios sem regressão.

- [ ] **Step 7: Commit**

```bash
rtk git add src/lib/export/pdf-dashboard.ts src/lib/export/pdf-dashboard-mapa.ts src/lib/export/__tests__/pdf-dashboard.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
rtk git commit -m "fix: polish dashboard PDF product ranking"
```
