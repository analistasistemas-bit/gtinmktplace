# ADR-0070 — Corrige sinônimo de tipo de fio/linha errado no título (grounded, mas trocado)

**Status:** Aceito
**Data:** 2026-07-13
**Decisores:** Diego
**Relaciona:** estende [ADR-0054](0054-categoria-titulo-tipo-produto-generico.md) (tipo de produto no
título via `tipo_produto_busca`), [ADR-0044](0044-cor-no-titulo-mono-cor.md) (mesmo padrão de guard
determinístico pós-IA), [ADR-0051](0051-tipo-aviamento-derivado-da-categoria-do-preditor.md) (`tipo_aviamento`)

## Contexto

Lote #63 (produtos "Linha Cléa" da Círculo): a IA gerou `titulo_ml = "FIO CLÉA 1000 151,3G | ..."`
quando o produto correto é **Linha Cléa** — a `descricao_pai` usa os dois sinônimos pra falar do
mesmo produto ("**Linha** Cléa 1000 para crochê... O **fio** Cléa é ideal para..."). Achado (2 casos
reais em produção, `familias.id` `2b993da1` e `7009be09`, ambos lote 63):

| `nome_pai` | `titulo_ml` (bug) | Devia ser |
|---|---|---|
| `L.CLEA 1000 CORES` | `FIO CLÉA 1000...` | `LINHA CLÉA 1000...` |
| `CLEA DUPLO CORES UND` | `FIO CLEA DUPLO...` | (sem sinal em `nome_pai`, não corrigido — ver Consequências) |

Um 3º caso do mesmo lote (`L.CLEA 125 CROCHE CORES`) já saiu correto (`LINHA CLEA 125...`) — a
mesma chamada de IA, com a mesma fonte, escolhe o sinônimo certo ou errado de forma inconsistente.

**Por que os guards existentes não pegam:** `validarTipoProdutoBusca`/`garantirTipoProdutoTitulo`
(ADR-0054) só verificam se a palavra escolhida pela IA **aparece literalmente** em `nome_pai` ou
`descricao_pai` ("grounded"). Aqui **os dois sinônimos são grounded** — "linha" e "fio" aparecem os
dois na descrição — então o guard aceita qualquer um dos dois; não existe hoje nenhum mecanismo que
decida QUAL dos dois grounded é o certo.

**Por que `tipo_aviamento` não serve como critério de correção:** cogitado e descartado. É uma
categoria ML larga (`Fios e Cadarços [de Armarinho]`) que mistura barbante/fio/linha
legitimamente distintos — confirmado em produção: `BARBANTE EUROROMA...` (cravado corretamente pelo
ADR-0054) e `FIO NAUTICO...`/`FIO DE MALHA...` (corretos) têm `tipo_aviamento='linha'`, o mesmo valor
das famílias Cléa com bug. Canonicalizar a partir de `tipo_aviamento` reverteria a cravação de
"BARBANTE" no EUROROMA (regressão do ADR-0054) e trocaria "FIO NAUTICO" por "LINHA NAUTICO"
(errado). `tipo_aviamento` responde "qual categoria do ML", não "qual palavra o produto usa".

## Decisão

`garantirTipoFioTitulo(titulo, nomePai)` (`_shared/ai/titulo.ts`), mesmo padrão determinístico dos
guards existentes:

1. Detecta o sinônimo que a **própria planilha** (`nome_pai`, fonte de verdade do produto) já
   declara: por extenso (regex `\b(LINHA|FIO|BARBANTE)\b`) ou pela abreviação `"L."` (convenção
   observada no catálogo: `L.CLEA`, `L.LIZA` = "Linha Cléa"/"Linha Liza", 100% consistente nas 4
   ocorrências em produção).
2. Se a 1ª palavra do título for um desses 3 sinônimos e for **diferente** do que `nome_pai`
   declara, substitui pela palavra declarada. Sem sinal em `nome_pai` → não mexe (conservador por
   construção; nunca infere a partir de sinônimos só grounded na descrição).
3. Encadeado **depois** de `garantirTipoProdutoTitulo` e **antes** de `garantirMetragemTitulo` nos 3
   pontos que montam título (mesmos do ADR-0054): `process-familia`, `regenerar-copy-familia`,
   `titulo-particao.ts`. A ordem importa: rodar antes de `garantirTipoProdutoTitulo` faria esse guard
   não achar mais o sinônimo antigo no título (já trocado) e reprefixar o tipo de produto por cima
   (duplicando); depois de `garantirMetragemTitulo`/`garantirCorTitulo` porque são eles que clampam
   o título final em 60 caracteres (a troca pode alongar em até 2 chars, "FIO"→"LINHA").

## Consequências

**Boas:**
- Fecha a classe do bug pra qualquer produto futuro cujo `nome_pai` declare o tipo de fio/linha/
  barbante — não é patch por palavra-chave de produto específico.
- Não retroativo por padrão (mesma política do ADR-0044): só afeta novas gerações/regenerações.

**Tradeoffs aceitos:**
- **`CLEA DUPLO CORES UND` continua incorreto** (sem "L." nem palavra por extenso em `nome_pai`,
  não há sinal literal pra corrigir sem inferir da descrição — mesmo risco que motivou não usar
  `tipo_aviamento`). Operador pode corrigir manualmente ou renomear o produto na planilha para
  incluir "L." se quiser cobertura automática.
- Lista de sinônimos fechada em 3 palavras (linha/fio/barbante) — o caso real observado. Não
  generaliza especulativamente pra outros tipos de aviamento (botão/fita/cola) sem evidência de
  confusão equivalente.

## Remediação retroativa

As 2 famílias do lote 63 encontradas com o bug (`2b993da1-3d86-4c9f-86fb-5cd9f4ad4695` "L.CLEA 1000"
e `7009be09-f645-4fa5-b39e-f3f4dc3aa72a` "CLEA DUPLO") **não foram corrigidas no banco/ML por este
ADR** — fica registrado como pendência operacional (regenerar copy manualmente via
`regenerar-copy-familia` e, se já publicado, `atualizarTituloML`), não uma correção automática em
massa.

## Como reverter

Remover o wiring de `garantirTipoFioTitulo` nos 3 pontos listados na Decisão 3; a função em si é
pura e isolada, sem efeito colateral se não for chamada.
