# Dashboard PDF Financial Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover liberações para abaixo do mapa e mostrar o total financeiro a receber, mantendo exatamente duas páginas.

**Architecture:** Acrescentar `totalAReceber` ao payload visual, preenchido pelo mesmo `resumo.aLiberar` do KPI. Reorganizar apenas as coordenadas da página geográfica para mapa/ranking acima e resumo financeiro abaixo.

**Tech Stack:** TypeScript, React, jsPDF, Vitest, Poppler.

## Global Constraints

- O PDF permanece com exatamente duas páginas A4 paisagem.
- O total não pode ser derivado das seis liberações visíveis.
- Manter limites de seis liberações e cinco UFs.
- Não alterar a primeira página, outros formatos ou outras telas.
- Não adicionar dependências ou rasterização.

---

### Task 1: Propagar total e reorganizar página geográfica

**Files:**
- Modify: `src/lib/export/tipos.ts`
- Modify: `src/lib/export/adapters.ts`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/lib/export/__tests__/pdf-dashboard-fixture.ts`
- Modify: `src/lib/export/__tests__/dashboard-adapter.test.ts`
- Modify: `src/lib/export/pdf-dashboard-mapa.ts`
- Modify: `src/lib/export/__tests__/pdf-dashboard-mapa.test.ts`

**Interfaces:**
- Consumes: `resumo.aLiberar: number`.
- Produces: `DashboardPdfVisual.totalAReceber: number`.

- [ ] **Step 1: Escrever testes RED**

No adapter, afirmar:

```ts
expect(report.dashboardPdf?.totalAReceber).toBe(resumo.aLiberar);
```

No renderer, afirmar presença de:

```ts
expect(pdf).toContain('Financeiro · Liberações próximas');
expect(pdf).toContain('Total a receber');
expect(pdf).toContain('R$ 319,55');
expect(doc.getNumberOfPages()).toBe(2);
```

Executar:

```bash
rtk pnpm exec vitest run src/lib/export/__tests__/dashboard-adapter.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
```

Esperado: falha por ausência do campo e dos novos rótulos.

- [ ] **Step 2: Propagar o dado bruto**

Adicionar ao tipo:

```ts
totalAReceber: number;
```

Preencher em `Dashboard.tsx` e `adapters.ts` com:

```ts
totalAReceber: resumo.aLiberar,
```

Atualizar o fixture padrão com `totalAReceber: 319.55`.

- [ ] **Step 3: Reorganizar a página 2**

Manter o cabeçalho em `y <= 25`. Posicionar o container do mapa/ranking em
`y = 29`, com altura suficiente até `y = 163`. Mover o bloco financeiro para
`y = 167`, terminando antes do rodapé em `y = 197`.

O bloco inferior deve usar:

```ts
doc.text('Financeiro · Liberações próximas', 17, 174);
doc.text('Total a receber', 280, 174, { align: 'right' });
doc.text(fmtBRL(data.totalAReceber), 280, 181, { align: 'right' });
```

Reservar a faixa direita para o total. Distribuir no máximo seis liberações na
faixa esquerda, mantendo o estado vazio sem ocultar o total.

- [ ] **Step 4: Executar GREEN e validações**

```bash
rtk pnpm exec vitest run src/lib/export/__tests__/dashboard-adapter.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts src/lib/export/__tests__/pdf-dashboard.test.ts tests/dashboard-pdf.fixture.test.ts
rtk pnpm exec tsc -b --pretty false
rtk pnpm exec eslint src/lib/export/tipos.ts src/lib/export/adapters.ts src/pages/Dashboard.tsx src/lib/export/__tests__/pdf-dashboard-fixture.ts src/lib/export/__tests__/dashboard-adapter.test.ts src/lib/export/pdf-dashboard-mapa.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
rtk git diff --check
```

Esperado: todos passam.

- [ ] **Step 5: Validar visualmente**

```bash
rtk proxy pdfinfo tmp/pdfs/dashboard-representativo.pdf
rtk proxy pdfinfo tmp/pdfs/dashboard-vazio.pdf
rtk proxy pdftoppm -f 2 -singlefile -png -r 150 tmp/pdfs/dashboard-representativo.pdf tmp/pdfs/financeiro-representativo
rtk proxy pdftoppm -f 2 -singlefile -png -r 150 tmp/pdfs/dashboard-vazio.pdf tmp/pdfs/financeiro-vazio
```

Esperado: exatamente duas páginas em ambos; mapa/ranking acima; resumo
financeiro abaixo; total legível; nenhum elemento cruza o rodapé.

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/export/tipos.ts src/lib/export/adapters.ts src/pages/Dashboard.tsx src/lib/export/__tests__/pdf-dashboard-fixture.ts src/lib/export/__tests__/dashboard-adapter.test.ts src/lib/export/pdf-dashboard-mapa.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
rtk git commit -m "fix: move dashboard PDF financial releases"
```
