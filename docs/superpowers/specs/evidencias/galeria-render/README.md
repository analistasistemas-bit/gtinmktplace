# Evidência do Step 5 da Task 12 (composição no navegador)

Data: 10/11/2026. Ambiente: Vite dev local em `localhost:5199`, com uma página de teste que importa `src/lib/galeria/compor.ts`. As cenas e a referência vieram de **outra origem** (`127.0.0.1:8799`, servidor com `Access-Control-Allow-Origin: *`), então a carga usou CORS de verdade, como no app. Nenhuma escrita em banco ou Storage de produção e nenhuma chamada paga.

## Entradas

- **Cenas reais da medição da Task 9:**
  - `nano-banana.jpg` (896×1200), usada nas missões 1, 2, 3 e 5;
  - `grok.jpg` (864×1152), usada nas missões 4 e 6.
- **Referência** (`ref.jpg`, 500×500), usada na lupa da 3 e nos recortes da 7 e de Moda 5.

As duas cenas foram geradas com o prompt **antigo**, que pedia "terço superior limpo". As áreas reservadas atuais (`layout-area.ts`) não existiam quando elas foram geradas, por isso o produto aparece sob alguns textos.

## Resultado

| Arquivo | Missão | Peso | `validarArquivoFinal` (Deno) |
|---|---|---|---|
| `m1.jpg` | 1 capa (corte ~4%, sem texto) | 234 KB | `[]` |
| `m2.jpg` | 2 headline + sub | 271 KB | `[]` |
| `m3.jpg` | 3 headline + sub + chip + lupa | 275 KB | `[]` |
| `m4.jpg` | 4 benefícios, acento `#1f2a52` | 232 KB | `[]` |
| `m5.jpg` | 5 ficha com 4 pares | 252 KB | `[]` |
| `m6.jpg` | 6 quatro etapas, acento `#c94f7c` | 227 KB | `[]` |
| `m7.jpg` | 7 recorte: duas lupas + legendas, sem cena | 110 KB | `[]` |
| `moda2.jpg` | Moda 2: sem texto (mesmo corte da capa) | 234 KB | `[]` |
| `moda5.jpg` | Moda 5: recorte 1200×1200, sem texto | 131 KB | `[]` |

- Todos os arquivos saíram como blob `image/jpeg` de 1200×1540, na qualidade 0,92 e abaixo de 1 MB, sem erro de canvas sujo.
- Cada `*-400.jpg` é o mesmo arquivo reduzido a 400 px de largura (miniatura do celular, R6.5). Os textos continuam legíveis.
- **Sem CORS:** a mesma cena servida por `127.0.0.1:8798`, sem o cabeçalho, foi recusada com "Não foi possível carregar a imagem para compor". O canvas nunca chega a ficar sujo.

## O que a evidência mostrou

1. **Missão 6:** a cena antiga tem o produto no terço inferior, e a fita passa sob a placa da 4ª etapa. Isso fica pendente até haver cena real gerada com "top 73%".
2. **Missões 3 e 4:** as cenas antigas também têm produto nas áreas que hoje ficam reservadas (canto inferior esquerdo da 3, coluna esquerda da 4). Conferir com cenas novas.
3. **Lupas:** `recortesDetalhe` corta a coluna central da referência em 15% e 85% da altura. Nesta referência, que é uma cena e não um recorte do produto, as lupas pegaram parede e mesa, em vez de trama ou borda. Além disso, a referência de 500 px é ampliada cerca de 2,5× na lupa da 7. É preciso decidir de onde vem o recorte (por exemplo, a caixa do produto ou da etiqueta lida pela visão, como na Task 6b).
