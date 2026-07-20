# QA visual do PDF do Dashboard

Data da inspeção: 20/07/2026  
Timestamp fixo do fixture: `2026-07-20T10:31:00-03:00`

## Artefatos

- `tmp/pdfs/dashboard-representativo.pdf`: 2 páginas, A4 paisagem (`841.89 x 595.28 pts`).
- `tmp/pdfs/dashboard-vazio.pdf`: 2 páginas, A4 paisagem (`841.89 x 595.28 pts`).
- Renderização inspecionada a 150 DPI: páginas 1 e 2 dos dois cenários.

## Comandos

```bash
rtk pnpm test tests/dashboard-pdf.fixture.test.ts
rtk proxy pdfinfo tmp/pdfs/dashboard-representativo.pdf
rtk proxy pdfinfo tmp/pdfs/dashboard-vazio.pdf
rtk proxy mkdir -p tmp/pdfs/rendered
rtk proxy pdftoppm -png -r 150 tmp/pdfs/dashboard-representativo.pdf tmp/pdfs/rendered/dashboard-representativo
rtk proxy pdftoppm -png -r 150 tmp/pdfs/dashboard-vazio.pdf tmp/pdfs/rendered/dashboard-vazio
```

O runner Vitest versionado importa `scripts/fixtures/dashboard-pdf.ts` e regenera os dois cenários com a toolchain existente do projeto.

## Checklist visual

| Critério | Resultado | Evidência |
|---|---|---|
| Exatamente duas páginas, sem clipping, sobreposição ou texto cruzando cards/rodapés | PASS | `pdfinfo` confirmou 2 páginas nos dois PDFs; as quatro renderizações não apresentam cortes ou colisões. |
| Oito KPIs e métrica selecionada na página 1 | PASS | 2 KPIs principais + 6 secundários; o gráfico identifica visualmente `Faturamento`, `Líquido` ou `Pedidos`, conforme a seleção. |
| Título longo termina em reticências e preserva unidades/valor | PASS | Os quatro títulos representativos são truncados; unidades e valores permanecem legíveis e alinhados. |
| Marcador de um ponto e eixo seguro | PASS | Marcador azul único visível em `20/07`, com ticks `R$ 0,00`, `R$ 228,28` e `R$ 456,56`. |
| Liberações, mapa, cinco barras, percentuais e nota de sem localização | PASS | Página 2 mostra liberação `18/08`, mapa vetorial, MG/TO/BA/MT/SC, percentuais corretos e `1 pedido sem localização`. |
| Mensagens vazias visíveis e centradas | PASS | Gráfico, produtos, liberações e ranking exibem mensagens centralizadas; mapa vazio permanece legível. |
| Fundo claro, hierarquia violeta/azul, âmbar para atenção e verde restrito a valores positivos | PASS | Fundo claro e cartões suaves; violeta no mapa/ranking, azul no gráfico/deltas e faixa âmbar. Verde não é usado fora de valores positivos. |
| Bordas do mapa e linha/gráfico nítidos a 150 DPI | PASS | Divisas estaduais, gradiente, barras e eixos permanecem nítidos; a série de três pontos confirma linha azul e preenchimento vetorial suave sem ocultar a escala. |

## Defeitos encontrados e corrigidos

1. A liberação curta `18/08` era renderizada como `Invalid Date`.
2. Participações já expressas em percentual eram multiplicadas por 100 (`4.440%`).
3. Mensagens vazias de produtos, liberações e ranking não estavam centralizadas.
4. O total de pedidos sem localização não era exibido.

Após as correções, os PDFs foram regenerados, renderizados novamente e as quatro páginas foram reinspecionadas.
