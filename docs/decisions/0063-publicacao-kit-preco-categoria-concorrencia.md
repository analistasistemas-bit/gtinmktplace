# ADR-0063: Publicação — kit condicional, piso de preço, categoria via catálogo, concorrência por product_identifier

**Status:** Aceito — **exceto a decisão #2 (preço), REVERTIDA em 2026-07-06**
**Data:** 2026-07-06
**Decisores:** Diego

> ⚠️ **Decisão #2 (preço — "nunca abaixo do piso viável" no ramo competitivo) foi REVERTIDA.**
> Ela violava o ADR-0020 e o ADR-0050, que definem: **com concorrente o preço é PURO MERCADO
> (menor × 0,95); o gross-up/frete é EXCLUSIVO do ramo sem concorrência.** O piso no ramo
> competitivo gerava preço acima de todo o mercado (ex.: R$ 34,40 vs concorrente R$ 19,47) e o
> selo "COMPETITIVO/Vale a pena" mentiroso. As decisões #1 (kit), #3 (categoria) e #4
> (concorrência) permanecem válidas.

## Contexto

Lote #27 (barbante Barroco Maxcolor) expôs 4 falhas independentes no CREATE, cada uma num
subsistema diferente — daí a sensação de "cada lote, um erro novo":

1. **"Unidades por kit" exigido num produto que não é kit.** `UNITS_PER_PACK` é
   `conditional_required` no ML (só obrigatório SE for kit), mas `atributosFaltantesGenerico`
   tratava todo `conditional_required` como obrigatório-duro → travava a Revisão. `preencherUnitsPerPack`
   só preenchia quando extraía "N unidades" do nome (heurística frágil), então travava inconsistente.
2. **Preço competitivo no prejuízo.** `sugerirPrecoVenda` no ramo competitivo definia
   `concorrente × (1 − desconto%)` ignorando custo/comissão/frete/imposto — para barbante barato
   com frete por conta do vendedor, o preço ficava abaixo do custo. Comissão/frete nem eram
   buscados quando havia concorrente (guard `!competitivo`).
3. **Categoria "Outros" no mesmo produto.** A categoria vinha 100% do preditor textual do ML;
   nomes ruidosos ("BARROCO MAXCOLOR BRILHO 200GR") caíam na genérica enquanto irmãs achavam "Lãs".
4. **"Sem concorrência" com concorrência óbvia.** `buscarConcorrencia` usava
   `/products/search?q={gtin}` (busca textual frágil) em vez de `product_identifier={gtin}`
   (lookup oficial de EAN — que o módulo de catálogo já usava), e tentava só 1 EAN sem fallback.

## Decisão

1. **Kit:** `preencherUnitsPerPack` assume `UNITS_PER_PACK = 1` (produto avulso) quando a categoria
   o expõe e não há contagem clara no nome. Kits reais ("N unidades") continuam extraídos. Nunca
   mais trava pedindo "unidades por kit" num item avulso.
2. **Preço — nunca abaixo do piso viável** (decisão do Diego): o ramo competitivo passa a usar
   `max(preço_competitivo, grossUp(piso, comissão, frete, imposto))`. Quando o piso viável fica
   acima da concorrência, publica no piso e sinaliza no `estrategia_motivo` ("piso viável — pouco
   competitivo"), deixando o operador decidir ajustar/não publicar. Comissão/frete passam a ser
   buscados também no caminho competitivo.
3. **Categoria via NOME de catálogo:** quando o preditor textual cai em genérica/manual (nome
   ruidoso), re-roda o preditor com o NOME CANÔNICO do produto de catálogo achado pela concorrência
   (`concorrencia.product_name`, ex.: "Fio Barroco Maxcolor Brilho ... Crochê") e pega o 1º
   candidato específico. Verificado na API: o `category_id` do produto de catálogo NÃO é exposto
   (só `domain_id`), mas o nome canônico resolve — o do BRILHO → MLB271471 "Lãs". Compõe com o
   fix #4 (que acha o produto de catálogo). Resiliente: só genérico/falha → mantém o texto.
4. **Concorrência:** `product_identifier={gtin}` em vez de `q={gtin}`, e tenta até 5 EANs da
   família (as cores são o mesmo produto de catálogo; nem todo EAN está indexado). Alinha com
   `catalogo.ts` (que já acertava).

## Consequências e limitações

- Fix #2 pode fazer o preço ficar **acima** da concorrência para produtos onde o frete/custo
  inviabiliza competir — é intencional (não vender no prejuízo); o operador vê o aviso e decide.
- Buscar comissão/frete sempre adiciona ~2 chamadas ao ML por família competitiva.
- O rótulo do semáforo ("mín. líquido") ainda mostra `variacoes.preco` enquanto classifica pelo
  custo por cor — inconsistência de display secundária (não coberta aqui); com o piso aplicado, o
  caso comum deixa de exibir "Prejuízo".
- Fix #3 depende de o produto estar no catálogo do ML (via GTIN); fora do catálogo, mantém o
  preditor textual.

## Como reverter

Reverter os 4 pontos: `preencherUnitsPerPack` (voltar a `if (n==null) return`), `sugerirPrecoVenda`
(remover o piso no ramo competitivo), o guard `!competitivo` em `process-familia`, o bloco de
override de categoria por catálogo, e `product_identifier`→`q` em `concorrencia.ts`.
