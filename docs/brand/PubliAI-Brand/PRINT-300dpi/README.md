# PubliAI — Arquivos para gráfica (300 DPI)

Os PNG de `../PNG/` são para tela (máx. 720px @72dpi). Esta pasta é a versão de impressão.

| Lockup | PNG | Tamanho impresso |
|---|---|---|
| `horizontal/` | 3543 × 970 px | 30 cm de largura |
| `empilhado/` | 2362 × 2052 px | 20 cm de largura |
| `simbolo/` | 1772 × 1772 px | 15 cm de largura |

PNG transparente, 300 DPI gravados no arquivo. Cada pasta traz também o **`.pdf` vetorial** —
**prefira o PDF**: escala para qualquer tamanho sem perda. Use o PNG só se a gráfica pedir raster.

## Qual variante mandar

| Variante | Quando |
|---|---|
| `full-light` | fundo claro / papel branco — **o caso normal de gráfica** |
| `full-dark` | fundo escuro (o wordmark é quase branco) |
| `mono-black` | impressão em 1 cor, fundo claro |
| `mono-white` | impressão em 1 cor, fundo escuro / knockout |

Gerados a partir dos SVG de `../SVG/` com `rsvg-convert`. Para regerar em outro tamanho, use o SVG
como fonte — nunca reamostre o PNG.

Cores, usos proibidos e demais regras: `../README.md`.
