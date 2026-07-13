# ADR-0072: Título — duplicação de tipo de produto/cor por checagem exata demais

**Status:** Aceito
**Data:** 2026-07-13
**Decisores:** Diego

## Contexto

Lote #33 gerou dois títulos com duplicação visível:

1. `POMPOM POM POM BÚFALO 14MM C/100UND | 100% POLIÉSTER | MACIO`
2. `LÁPIS DE ESCREVER RESINA 7 VERDE REF.SL101066-8 VERDE 7`

Causa raiz em ambos: os guards determinísticos de `_shared/ai/titulo.ts` que evitam duplicar um
termo já presente no título comparam **a frase inteira, na mesma ordem/espaçamento**, em vez de
verificar se a informação já está coberta.

1. **`garantirTipoProdutoTitulo`** (ADR-0054): a IA devolveu `tipo_produto_busca = "pompom"`
   (uma palavra colada), mas o nome/título já usa a forma espaçada "POM POM". A checagem
   `\bPOMPOM\b` não bate contra "POM POM" (o espaço quebra a contiguidade) → o guard concluiu que
   o tipo estava ausente e prefixou "POMPOM " de novo.
2. **`garantirCorTitulo`**: a cor real do produto é literalmente "Verde 7" (confirmado na seção
   de cores da descrição). O nome_pai tem "...RESINA **DE 7** VERDE..." — "7" e "VERDE" já
   aparecem no título, só que na ordem inversa da cor. A checagem por frase exata `\bVERDE 7\b`
   não bate → o guard reanexou " VERDE 7" no fim, redundante.

Não é um problema de qualidade do modelo de IA — o texto que a IA gera já está correto nos dois
casos; o bug está inteiramente no pós-processamento determinístico que roda depois.

## Decisão

Duas checagens novas em `titulo.ts`, aplicadas nos dois guards:

1. `todasPalavrasCobertas(titulo, termo)`: para termos multi-palavra (cor), considera "já
   presente" quando **todas** as palavras do termo aparecem como palavra inteira em qualquer
   lugar do título — sem exigir ordem nem adjacência. Substitui a checagem de frase exata em
   `garantirCorTitulo`. Usa "todas" (não "alguma") para não perder a diferenciação entre
   cores-irmãs quando só parte do nome da cor já está no título.
2. `termoColadoNoTitulo(titulo, termo)`: fallback para termo composto que a IA devolve colado
   ("pompom") enquanto o título usa a forma espaçada ("POM POM") — remove espaços dos dois lados
   e testa contenção simples. Usado como `OR` na checagem existente de `garantirTipoProdutoTitulo`
   (a checagem por palavra, que já cobre corretamente o caso de frases com preposição como
   "barbante de crochê", continua intacta; o fallback só entra quando ela falha).

## Consequências

- Não muda o comportamento em nenhum caso já coberto pelos testes existentes — só adiciona
  cobertura para os dois padrões (espaçamento colado × espaçado; ordem invertida) que geravam
  duplicação.
- `termoColadoNoTitulo` faz correspondência por substring sem limite de tamanho mínimo — risco
  residual de falso positivo (achar "já coberto" por coincidência de letras) é baixo porque só
  entra em jogo quando a checagem por palavra já falhou, mas não é zero.

## Como reverter

Reverter `todasPalavrasCobertas` em `garantirCorTitulo` (voltar à regex de frase exata) e remover
o `|| termoColadoNoTitulo(...)` em `garantirTipoProdutoTitulo`.
