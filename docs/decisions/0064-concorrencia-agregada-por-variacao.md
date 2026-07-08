# ADR-0064 — Busca de concorrência agregada por todas as variações da família

**Status:** Aceito
**Data:** 2026-07-08
**Decisores:** Diego
**Relacionado:** [ADR-0014 (busca de concorrência)](0014-busca-de-concorrencia.md); [ADR-0063 (publicação lote #27)](0063-publicacao-kit-preco-categoria-concorrencia.md); [ADR-0059 (desconto concorrência)](0059-desconto-concorrencia-configuravel.md); [ADR-0015 (potencial de venda)](0015-potencial-de-venda-via-proxies.md)

---

## Contexto

A busca de concorrência (ADR-0014) resolvia a família tentando os GTINs das variações e
**parando no 1º que casasse** no catálogo do ML — premissa herdada do lote #27 (Barroco
Maxcolor), onde todas as cores da família apontam para o **mesmo** produto de catálogo.

Essa premissa é **falsa para famílias cujas cores são produtos de catálogo *distintos* no
Mercado Livre**. Caso real (lote #28): a linha **Anne 500m** tem 46 cores, e cada cor tem
GTIN próprio e **produto de catálogo separado** (MLB IDs, nomes canônicos e **preços
diferentes**). A busca antiga pegou a 1ª cor que casou (Mult Carrossel/Sereia 9490 →
`MLB28400021`, R$ 32,90, 3 vendedores) e reportou isso como "menor preço da concorrência"
de toda a família — falso: havia cores bem mais baratas (ex.: Branca 8001 → `MLB26672898`,
**R$ 22,39**, 22 vendedores) que nunca eram consultadas.

**Impacto:** o operador via um "menor preço" acima do mercado real, com risco de precificação
errada (o preço competitivo é calculado a partir desse menor preço — ADR-0020/0059).

## Decisão

`buscarConcorrencia` passa a:

1. **Resolver TODAS as variações com GTIN válido** (GTIN GS1 real; `gtinValido` exclui nulos,
   não-numéricos e prefixo interno `3000*`) em vez da 1ª que casa. As buscas rodam em paralelo
   (`pool`, limite 6 workers; cap defensivo de 60 GTINs). Cada variação faz o lookup de catálogo
   (`/products/search?product_identifier={gtin}`) e, se casar, enumera ofertas
   (`/products/{product_id}/items`).

2. **Agregar os resultados** via nova função pura `agregarConcorrencia`:
   - **Menor preço global:** mínimo dos `preco_min` entre todas as cores casadas.
   - **Faixa de preço:** min–max global dos preços das ofertas.
   - **Vendedores:** união distinta de `seller_id` (um vendedor que aparece em várias cores conta
     1x); se nenhuma cor trouxe `seller_id`, cai para a soma dos totais por cor.
   - **Ofertas/frete grátis/FULL:** somados entre as cores.
   - **Produto representativo** (`product_id`/`product_name`): o da cor mais barata — é o que
     torna o "menor preço" verdadeiro e alimenta a resolução de categoria (lote #27) e a
     análise de mercado (ADR-0015).

3. **Negative caching** (tombstone por GTIN): um GTIN que não acha produto no catálogo é
   cacheado como "sem produto" (`product_id: null`, TTL 6h, mesma chave `cache:concorrencia:gtin:*`).
   Sem isso, uma família de dezenas de cores refaria a busca de cada EAN não indexado a cada
   reprocesso. É o que torna a cobertura total viável sem repetir buscas inúteis. Erro
   **transitório** (timeout/rede) NÃO vira tombstone — é re-tentado na próxima execução.

4. **Contrato de `buscarConcorrencia` inalterado** (backward-compatible): mesma shape de
   `ResultadoConcorrencia` (`vendedores`, `preco_min`, `origem`, `classe`, `product_id`,
   `product_name`, `ofertas`). Os callers `process-familia` e `analisar-viabilidade` não mudam;
   `analisar-viabilidade` passa 1 GTIN → agregação degenera para o próprio resultado.

## Consequências

**Boas:**
- Corrige o "menor preço" para famílias multi-cor com catálogos distintos (Anne: R$ 32,90 → R$ 22,39).
- Cobertura total na 1ª busca, amortizada pelo cache (hits e tombstones, TTL 6h) nos reprocessos.
- Falha parcial degrada em vez de quebrar: erro de rede em uma cor não descarta as demais nem os
  hits já resolvidos do cache.
- Backward-compatible: callers existentes não precisam mudar.

**Tradeoffs aceitos:**
- **Latência da 1ª busca** cresce com o nº de cores (paralelizada em 6 workers; a maioria dos
  EANs não indexados retorna rápido, só os que casam fazem a 2ª chamada de ofertas). Amortizada
  por cache nos reprocessos.
- **Amostragem por preço:** o "menor preço" é o mínimo entre as cores que têm produto de catálogo
  no ML; cores sem catálogo não entram (não há como cotá-las por EAN).
- **Contagem de vendedores é aproximada** quando alguma cor não traz `seller_id` (raro; o ML
  quase sempre retorna) — afeta só a contagem/classe, nunca o preço.
- **Tombstone tem janela de 6h:** um EAN que entra no catálogo depois só aparece após o TTL expirar.

## Como reverter

1. Em `buscarConcorrencia` (`_shared/ml/concorrencia.ts`), voltar a parar no 1º GTIN que casa.
2. Remover `agregarConcorrencia` (`_shared/concorrencia/agregar.ts`) e o negative caching.
3. Callers (`process-familia`, `analisar-viabilidade`) seguem funcionando — o contrato é o mesmo.

---

## Validação

Verificado ao vivo contra a API do Mercado Livre (token real da org Avil) exercitando o parse
de produção + `agregarConcorrencia` sobre os 44 GTINs válidos da família Anne 500m do lote #28:

- **43 cores** têm produto de catálogo distinto no ML (2 EANs `3000*` são filtrados por
  `gtinValido`; alguns EANs não indexados viram tombstone).
- **Antes:** reportava R$ 32,90 (só a cor Sereia/9490, `MLB28400021`).
- **Depois:** menor preço agregado **R$ 22,39** (cor Branca 8001, `MLB26672898`, 22 vendedores),
  faixa R$ 22,39–149,90, 48 vendedores distintos (união), classe "alta", representativo = a cor
  mais barata.

Testes unitários de `agregarConcorrencia`: 11 casos (mín/máx global, união e dedup de sellers,
somas, representativo = mais barato, fallback de contagem, `category_id` do 2º produto, empate
de menor preço, lista vazia). Suíte completa verde.
