# Task 5 report — Stable PDF Fixture and Visual QA

## Resultado

- Fixture estável criado em `scripts/fixtures/dashboard-pdf.ts`, com timestamp `2026-07-20T10:31:00-03:00`.
- Cenários representativo e vazio gerados em `tmp/pdfs/`.
- Ambos os PDFs têm exatamente 2 páginas A4 paisagem.
- Quatro páginas renderizadas a 150 DPI e inspecionadas visualmente.
- QA detalhada registrada em `docs/superpowers/qa/dashboard-pdf-visual.md`.

## TDD e correções motivadas pela inspeção

- RED: runner direto `rtk pnpm exec vite-node scripts/fixtures/dashboard-pdf.ts` falhou porque `vite-node` não está exposto como executável.
- GREEN: runner Vitest temporário importou o fixture, gerou os dois arquivos e passou; o arquivo auxiliar foi removido.
- RED: teste regressivo de data curta e participação normalizada falhou com a implementação anterior.
- GREEN: data `DD/MM` passou a ser preservada e `participacao` deixou de ser multiplicada por 100.
- RED/GREEN: teste para `semLocalizacao` provou a ausência da nota e passou após a inclusão de `1 pedido sem localização`.
- Correção visual mínima: mensagens vazias de produtos, liberações e ranking foram centralizadas; a validação foi feita pela reinspeção dos PNGs.

## Comandos e resultados

```bash
rtk pnpm test src/lib/export/__tests__/pdf-dashboard-mapa.test.ts
# PASS: 6 testes

rtk pnpm test src/lib/export/__tests__/dashboard-adapter.test.ts src/lib/export/__tests__/pdf-dashboard.test.ts src/lib/export/__tests__/pdf-dashboard-mapa.test.ts src/lib/export/__tests__/index.test.ts tests/components/botao-exportar.test.tsx
# PASS: 5 arquivos, 27 testes

rtk pnpm exec tsc -b --pretty false
# PASS

rtk pnpm exec eslint src/lib/export src/components/export/botao-exportar.tsx src/pages/Dashboard.tsx tests/components/botao-exportar.test.tsx scripts/fixtures/dashboard-pdf.ts
# PASS

rtk pnpm test
# PASS: 213 arquivos, 1666 testes

rtk proxy pdfinfo tmp/pdfs/dashboard-representativo.pdf
rtk proxy pdfinfo tmp/pdfs/dashboard-vazio.pdf
# PASS: Pages: 2; Page size: 841.89 x 595.28 pts (A4), em ambos

rtk proxy pdftoppm -png -r 150 tmp/pdfs/dashboard-representativo.pdf tmp/pdfs/rendered/dashboard-representativo
rtk proxy pdftoppm -png -r 150 tmp/pdfs/dashboard-vazio.pdf tmp/pdfs/rendered/dashboard-vazio
# PASS: 4 PNGs
```

A suíte completa emite avisos preexistentes de refs/descrição em componentes Radix e logs esperados de testes de erro; não houve falha.

## Evidências visuais

- Representativo p.1: oito KPIs, faixa de atenção, marcador único, eixo seguro e produtos truncados sem ocultar unidades/valor.
- Representativo p.2: liberação `18/08`, mapa nítido, cinco UFs, cinco barras, percentuais `44,4%`/`11,1%` e nota `1 pedido sem localização`.
- Vazio p.1: mensagens de gráfico e produtos visíveis e centralizadas.
- Vazio p.2: mensagens de liberações e ranking visíveis e centralizadas; mapa vetorial sem dados permanece nítido.
- Nenhuma página tem clipping, sobreposição, texto sobre rodapé ou terceira página.

Os PDFs e PNGs em `tmp/pdfs/` não são versionados; os PNGs intermediários foram removidos antes do commit.
