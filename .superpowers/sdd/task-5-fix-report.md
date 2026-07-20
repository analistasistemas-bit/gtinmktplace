# Task 5 — correções da revisão

Commit da implementação: `3260bac`

## Findings verificados e corrigidos

1. O comando documentado apontava para `tests/dashboard-pdf.fixture.test.ts`, mas o runner havia sido removido. O entrypoint Vitest foi restaurado, importa o fixture versionado e confirma que os dois PDFs são gerados.
2. O gráfico formatava eixo e escala conforme `data.metrica`, mas não mostrava qual métrica estava selecionada. A página 1 agora exibe `Métrica: Faturamento`, `Métrica: Líquido` ou `Métrica: Pedidos`.

## Evidência TDD

- RED: os três casos de métrica falharam porque os rótulos não existiam no PDF.
- GREEN: os três casos passaram após adicionar o rótulo derivado de `data.metrica`.
- O runner restaurado passou e regenerou `dashboard-representativo.pdf` e `dashboard-vazio.pdf`.

## Validação

- Testes focados: 6 arquivos, 32 testes passando.
- TypeScript: `rtk pnpm exec tsc -b --pretty false` passou.
- ESLint dirigido: passou.
- `rtk git diff --check`: passou.
- `pdfinfo`: cenário vazio com 2 páginas A4 paisagem.
- Página 1 do cenário vazio/pedidos renderizada a 150 DPI e inspecionada: `Métrica: Pedidos` está legível, alinhada ao cabeçalho do gráfico e sem colisões.
- Artefatos em `tmp/` não foram versionados.

Aviso de `ref` do Radix durante `botao-exportar.test.tsx` é preexistente e não foi alterado.
