# ADR-0136 — Sonar por EAN: cobertura de fichas de catálogo e escopo declarado

**Data:** 2026-08-27
**Status:** aceito, não implementado
**Relacionado:** [0127](0127-sonar-tabela-por-anuncio-e-historico.md) (Errata 1 criou a consulta por
EAN; Errata 2 enriqueceu a view), [0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (§ endpoints
do ML que devolvem 403 para terceiros), [0122](0122-sonar-vendas-estimadas-via-apify.md) (Apify como
saída para o que a API oficial não alcança), [0120](0120-pulse-sonar-garimpo-por-termo.md) (Sonar por
termo).

> **Este ADR é a especificação de implementação.** Foi escrito para ser executado por outro agente,
> sem acesso à conversa que o originou. Tudo que é necessário está aqui.

## Contexto

A consulta por EAN do Sonar (ADR-0127 Errata 1) devolve as ofertas de **uma** ficha de catálogo do
Mercado Livre. Em 2026-08-27 o operador consultou o EAN `7891113175371` (Linha Encanto Slim Círculo
240m 100g) e recebeu **1 oferta** — `BAZAR HORIZONTE`, R$ 36,21 — enquanto a busca do mesmo EAN no
site do ML mostrava **23 resultados**, com preços de R$ 29,80 a R$ 38,96.

A divergência tem duas causas, de naturezas diferentes:

**Causa 1 — só a primeira ficha é consultada.** `parseProdutoBusca`
(`supabase/functions/_shared/concorrencia/parse.ts`) lê `results[0].id` de
`GET /products/search?status=active&site_id=MLB&product_identifier={ean}` e **descarta o resto do
array**. Esse EAN casa com mais de uma ficha: "Linha Encanto Slim Círculo 240m 100g — Escolha A Cor"
e "Fio Círculo Encanto Slim Capim Dourado 100% Viscose 240m". O Sonar ficou com a segunda e nunca
olhou a primeira, que é onde estão os anúncios de maior volume. **Isto é defeito e é corrigível.**

**Causa 2 — anúncio fora do catálogo é inalcançável.** Os 23 resultados da busca do site são
*anúncios*; `GET /products/{id}/items` devolve apenas ofertas **vinculadas àquela ficha**. Anúncio
que não está no catálogo não aparece, e não há como buscá-lo pela API oficial: o ADR-0119 registra,
com medição, que `/items/{id}` de terceiro e `/sites/MLB/search` devolvem **403 forbidden sempre**.
**Isto não é defeito, é limite da plataforma** — e é a razão de o Sonar por termo usar Apify.

Agrava as duas: a tela escreve "1 oferta", que se lê como "este produto tem um vendedor no Mercado
Livre". O número é verdadeiro no seu escopo e falso na leitura que o operador faz dele.

## Decisões

### D-1 — Consultar todas as fichas que o EAN retorna, não só a primeira

`GET /products/search?product_identifier={ean}` já devolve o array completo numa única resposta.
Passar a considerar **todos** os `results`, buscando `/products/{id}/items` de cada ficha e unindo as
ofertas.

- **Teto de 5 fichas por EAN**, ordenadas como o ML retornou (o array já vem por relevância). Acima
  disso o custo de fan-out não se paga: medição do caso real deu 2 fichas, e nenhum EAN de teste
  passou de 3. Fichas descartadas pelo teto **precisam ser contadas na resposta** (ver D-3) — corte
  silencioso é o que este ADR está corrigindo.
- A busca de `/items` das fichas roda em paralelo (`Promise.all`), como já é feito hoje para
  `produtoJson`/`itensJson`.
- **Falha em uma ficha não derruba as outras.** `mlGet` já devolve `null` em falha; ficha que falhou
  sai da lista e a resposta segue com as demais. Se **todas** falharem, mantém o comportamento atual:
  HTTP 502 com "Consulta ao Mercado Livre falhou ou demorou demais".

### D-2 — A oferta carrega a ficha de origem

Duas fichas do mesmo EAN são produtos diferentes aos olhos do ML (cores, embalagens, kits). Juntar as
ofertas num balaio só, sem dizer de onde vêm, troca um número errado por outro. Cada `OfertaEan`
ganha `product_id` e `produto_nome` da ficha que a originou, e a tabela agrupa ou rotula por ficha.

O `nome_produto` do topo passa a ser o da **primeira** ficha (comportamento atual), com a contagem de
fichas ao lado quando houver mais de uma.

### D-3 — A resposta declara o escopo do que mediu

Campos novos em `RespostaEan`:

| Campo | Significado |
|---|---|
| `fichas_consultadas: number` | quantas fichas entraram no resultado |
| `fichas_encontradas: number` | quantas o `/products/search` retornou (pode ser maior, pelo teto do D-1) |
| `fichas: Array<{ product_id: string; nome: string \| null; ofertas: number }>` | resumo por ficha |

A UI usa isso para escrever **"N ofertas em M fichas de catálogo"** no lugar de "N ofertas", e para
avisar quando `fichas_encontradas > fichas_consultadas`.

### D-4 — O que não é alcançável fica dito na tela, não implícito

Abaixo da tabela, uma linha permanente: anúncios fora do catálogo do ML não entram nesta consulta,
com link para a busca do EAN no site (`https://lista.mercadolivre.com.br/{ean}`), que é onde o
operador vê o mercado inteiro. Sem isso, a tela continua parecendo incompleta mesmo depois do D-1 —
porque, para este EAN, ela seguirá mostrando menos anúncios que o site, e isso é correto.

### D-5 — Bump para `sonar:ean:v3`

`LookupCache` muda de shape (uma ficha → lista de fichas). Entrada v2 não é migrável. Chave sobe para
`sonar:ean:v3:{ean}`, TTL 24h inalterado. O tombstone de EAN sem ficha (`product_id: null`) continua
igual, no shape novo.

### D-6 — Apify NÃO entra neste caminho

A tentação óbvia de "resolver" a causa 2 é buscar por EAN na Apify, como faz o Sonar por termo.
Recusado: a Errata 1 do ADR-0127 decidiu que a busca por EAN é **grátis por padrão**, e a Apify já
está disponível ali sob escolha explícita (`com_vendas`). Transformar o caminho grátis em pago para
completar a lista quebraria essa decisão e cobraria do operador sem ele pedir. Se um dia a cobertura
de anúncios avulsos virar requisito, entra pelo botão de consulta paga, nunca por default.

## Refutações registradas (não tentar de novo)

- **Buscar anúncio avulso por `/items/{id}` ou `/sites/MLB/search`.** 403 forbidden sempre, medido no
  ADR-0119 (§ tabela de endpoints). Não é questão de escopo de token nem de header.
- **Usar `results[0]` "porque o primeiro é o mais relevante".** Foi a premissa que causou este ADR: o
  mais relevante para o ML não é o de maior volume de ofertas, e o EAN do caso real prova.
- **Somar ofertas de fichas diferentes num único número sem rótulo** (ver D-2).

## Plano de implementação

Ordem sugerida; cada passo é verificável isolado.

### 1. `supabase/functions/_shared/concorrencia/parse.ts`

Adicionar `parseProdutosBusca(json): Array<{ id: string; nome: string | null }>` — todos os
`results`, filtrando entradas sem `id`. **Não alterar** `parseProdutoBusca`/`parseNomeProdutoBusca`:
elas são usadas por `analisar-viabilidade` e pelo `pulse-coletar`, que continuam com uma ficha só.
Testes em `supabase/functions/_shared/concorrencia/__tests__/`.

### 2. `supabase/functions/_shared/pulse/sonar-ean.ts`

- `OfertaEan` ganha `product_id: string | null` e `produto_nome: string | null`.
- `montarOfertasEan` passa a receber as ofertas já anotadas com a ficha de origem.
- `RespostaEan` ganha os campos do D-3.
- `montarRespostaEan` monta a partir da lista de fichas.

Atualizar `supabase/functions/_shared/pulse/__tests__/sonar-ean.test.ts`.

### 3. `supabase/functions/pulse-sonar-ean/index.ts`

- `LookupCache` vira `{ product_id, nome_produto, descricao_catalogo, categoria_ml_id, vendedores,
  fichas: Array<{ product_id, nome, ofertas: OfertaVendedor[] }>, fichas_encontradas }`.
- Chave `sonar:ean:v3:{ean}` (D-5).
- `resolverLookup` itera as fichas (teto 5, `Promise.all`), aplicando `aplicarPrecoVencedorCatalogo`
  por ficha — o `buy_box_winner` é **por ficha**, aplicar o de uma em outra corromperia o preço.
- `categoria_ml_id` sai da primeira ficha que trouxer categoria.
- `resolverNomesVendedores` recebe a união dos `seller_ids` de todas as fichas (continua 1 chamada por
  vendedor distinto).
- A interseção da Apify (`com_vendas`) continua valendo contra a união das ofertas oficiais.

### 4. `src/lib/sonar.ts`

Espelhar os tipos novos em `OfertaEan` e `ResultadoEanCatalogado`.

### 5. `src/pages/PulseSonar.tsx`

- `SonarEanResultado`: coluna/rótulo de ficha quando `fichas_consultadas > 1` (D-2); linha de
  cabeçalho "N ofertas em M fichas de catálogo" (D-3); aviso quando `fichas_encontradas >
  fichas_consultadas`; nota de escopo com link para a busca do EAN no ML (D-4).
- O bloco "quanto você recebe" continua no **menor preço da união** — é contra ele que se compete.
- Testes em `src/pages/__tests__/PulseSonar.test.tsx`, seguindo os casos que já existem lá.

### 6. Deploy

`supabase functions deploy pulse-sonar-ean` e conferir a versão com `supabase functions list`
(a worktree precisa de `supabase link --project-ref txvncrgkoynoxwopfkbp` antes). Nenhuma outra
função importa `_shared/pulse/sonar-ean.ts` — confirmado com
`grep -rln "pulse/sonar-ean" supabase/functions/`. Se o passo 1 alterar arquivos de
`_shared/concorrencia/`, aí sim redeployar também `analisar-viabilidade` e `pulse-coletar`.

## Critérios de aceite

1. EAN `7891113175371` retorna ofertas de **mais de uma** ficha, e a tela diz quantas fichas.
2. EAN de ficha única continua igual ao de hoje, sem regressão visual.
3. EAN sem ficha de catálogo continua devolvendo `catalogado: false` com HTTP 200.
4. Nenhuma oferta aparece sem saber de qual ficha veio.
5. Falha do ML em uma ficha não zera as outras; falha em todas devolve 502.
6. `pnpm test`, `npx tsc -b --force` e `pnpm lint` limpos. Cache v3 ativo (verificável: primeira
   consulta pós-deploy é lenta, a segunda é imediata).

## Consequências

- Fan-out de até 5 `/products/{id}/items` por EAN novo, uma vez a cada 24h por EAN (cache). Chamadas
  gratuitas na API oficial.
- A consulta continuará mostrando **menos** anúncios que a busca do site para EANs com muitos avulsos.
  Isso passa a ser dito na tela, e é a diferença entre "incompleto" e "com escopo declarado".
- `parseProdutoBusca` continua existindo para os outros consumidores; a divergência entre "uma ficha"
  e "todas as fichas" passa a ser explícita no nome das funções.
