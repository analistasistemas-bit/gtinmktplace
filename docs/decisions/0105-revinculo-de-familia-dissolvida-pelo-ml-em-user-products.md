# ADR-0105 — Re-vínculo de família que o ML **dissolveu** em User Products (item Legacy fechado + irmãos sem SKU, casamento por COR)

**Status:** Aceito
**Data:** 2026-08-06
**Decisores:** Diego
**Relaciona:** resolve a hipótese que [ADR-0104](0104-update-de-familia-migrada-para-user-products.md) §2
deixou explicitamente aberta ("a forma da migração é hipótese validada em runtime"); reusa a saga e
os reconciliadores de [ADR-0088](0088-publicacao-user-products-multi-item.md); mantém intocado o
item plano de 1 cor de [ADR-0084](0084-family-name-categoria-zipper.md); herda o guard de anúncio
morto do lote #45 (`_shared/ml/anuncio-atualizavel.ts`).

## Contexto

O ADR-0104 previu que o Mercado Livre migraria famílias Legacy para User Products **convertendo o
próprio item** — `variations: []` + `family_name`/`family_id` na raiz — e construiu a adoção em
cima disso: detectar pelo `GET` ao vivo e localizar os irmãos por **SKU**
(`GET /users/{seller}/items/search?sku=`). O próprio ADR registrou que a forma real era hipótese e
que a primeira ocorrência traria o dado.

**A primeira ocorrência real chegou (lote #45, `PAI 02186551`, 2026-07-21) e a forma é outra.**

### O que o ML realmente fez (apurado na API, não suposto)

Item Legacy `MLB4847766197` (17 cores, categoria `MLB270273`):

| Campo | Valor observado |
|---|---|
| `status` | `closed` |
| `sub_status` | `[]` |
| `stop_time` | `2026-07-21T12:11:55Z` |
| `family_id` / `family_name` / `user_product_id` | **ausente / null / null** |
| `parent_item_id` | `null` |
| `variations` | ainda 17, com `seller_custom_field` (SKU) e `COLOR` |

E, em paralelo, **18 itens novos** (`MLB7210143182…214` + `MLB7218244860`), todos:

- `status: active`, `variations: []`
- `family_id: 2244380420892433` (o número que a UI do ML mostra como "o anúncio")
- `family_name: "Barbante Euroroma 4/6 600g 610mt | 85% Algodão"` (= título do item antigo)
- `user_product_id` próprio (ex.: `MLBU4389668130`)
- **`seller_custom_field: null`** — o ML **não** copiou o SKU

Ou seja: o ML **não converteu** o item; ele **dissolveu** a família — fechou o anúncio Legacy e criou
N anúncios novos, sem SKU e **sem nenhum ponteiro** do velho para o novo em lugar nenhum do corpo.

### Por que o código de hoje falha duas vezes

1. **O guard de anúncio morto dispara antes.** `mercado-livre.ts:169` chama
   `motivoAnuncioNaoAtualizavel` logo após o `GET`; com `status: closed` ele lança 400 —
   *"Anúncio closed no Mercado Livre. Estoque e preço não podem ser atualizados — republique o
   produto para voltar a vender."* — que é exatamente o erro na tela do operador. O ramo
   `MIGRADO_PARA_UP` (`:184`) é **inalcançável**.
2. **Mesmo alcançado, a adoção do ADR-0104 acharia 0 de 17.** `?sku=02186560` devolve **só** o item
   morto; os irmãos não têm `seller_custom_field`. A regra tudo-ou-nada abortaria sempre.

### Endpoints verificados (para não re-derivar)

| Chamada | Resultado |
|---|---|
| `/users/{s}/items/search?sku=<sku>` | devolve **só** o item Legacy morto |
| `/users/{s}/items/search?family_id=<id>` | **funciona** — devolve os 18 irmãos |
| `/users/{s}/items/search?family_name=<nome>` | **silenciosamente ignorado** (devolve todos os 416 itens do vendedor) |
| `/users/{s}/items/search?q=<título>` | 18 resultados = item morto + 17 irmãos |
| `/families/{id}`, `/user-products/{id}`, `/items/{id}/family` | 404 (não existem) |
| `GET /items/MLB<family_id>` | 404 — o número da UI é `family_id`, **não** um item |

## Decisão

**Quando o `GET` do UPDATE encontrar o anúncio em status terminal *sem* `sub_status` de remoção,
descobrir a família User Products que o substituiu e re-vincular por COR, reusando integralmente a
adoção do ADR-0104.**

### §1 — O gatilho é "terminal, mas não removido"

`motivoAnuncioNaoAtualizavel` continua sendo a primeira coisa depois do `GET`. O que muda é o que
acontece quando ele dispara:

- **`sub_status` ∈ {`deleted`, `forbidden`}** → lança 400 **exatamente como hoje**, byte a byte.
  Anúncio removido/bloqueado pelo ML não foi migrado; gastar descoberta ali é queimar a fila serial
  (`parallelism=1`, ADR-0034) para chegar na mesma mensagem.
- **`status` terminal (`closed`/`inactive`) com `sub_status` limpo** → o conector devolve
  `MIGRADO_PARA_UP` **tipado** (retorno normal, não exceção — mesmo padrão do ADR-0088 §3), com
  `dissolvido`: título, categoria, seller, o mapa `SKU → COR` lido das `variations` do item morto,
  e **a mensagem original do guard** como fallback.

Se a descoberta não achar nada, a orquestração lança **essa mesma mensagem original**. Um anúncio
genuinamente encerrado pelo vendedor continua produzindo o erro do lote #45, palavra por palavra —
custo: 2 chamadas de leitura a mais. Zero regressão observável.

### §2 — A chave de casamento é `COLOR.value_name`, **nunca** `variacoes.cor`

O SKU não sobrevive à dissolução; a **cor** sobrevive. E os dois lados do casamento são dados
**autorais do ML**:

```
SKU (variations do item morto) → COLOR (item morto) → COLOR (irmão) → item_externo_id novo
```

Verificado no caso real: bijeção perfeita, 17 cores → 17 irmãos, nenhuma duplicada.

**Casar contra `variacoes.cor` (nosso banco) é proibido.** A prova está nos próprios dados: os
irmãos trazem `'Rosa Bebê - 510'` ao lado de `'Cru 100'` — o ML não normaliza, e nossas strings de
cor não têm garantia nenhuma de igualdade com as dele. O item morto é o **único** lugar onde o ML
escreveu SKU e cor lado a lado; é ele que ancora a identidade. Uma "simplificação" futura que troque
essa fonte pelo banco publica estoque na cor errada, em silêncio.

### §3 — Descoberta em dois passos, com o autoritativo por último

1. **Localizar a família**: `?q=<título do item morto>`, multiget dos ids, e ficam só os candidatos
   que passam em **todas** as validações: `id ≠` item morto, `seller_id` = a conexão da org,
   `category_id` = a do item morto, `family_id` presente, `variations` vazio, `status` ∈
   {`active`, `paused`}. Os `family_id` distintos precisam ser **exatamente um**; 0 → "não achei",
   >1 → aborta com os ids observados.
2. **Enumerar a família**: `?family_id=<id>` — esta é a fonte autoritativa e completa, e é o que
   pega irmãos que a busca por título não devolveu. Daí sai o mapa `COR → item`.

**`family_name` não entra como filtro.** Ele coincide com o título aqui, mas isso é observação de um
caso, não invariante do ML; `family_id` único + cobertura total das cores é prova de identidade mais
forte e não depende de o ML preservar texto. (`?family_name=` como parâmetro de busca, aliás, é
ignorado pela API — ver tabela acima.)

O `family_name` observado nos irmãos vira o `titulo` da raiz `anuncios_externos` (o ADR-0104 §3 exige
esse campo, e o item morto não tem nenhum para dar).

### §4 — A adoção em si é a do ADR-0104, sem uma linha nova de regra

`adotarFamiliaMigrada` fica **intocada**. O que muda é só a implementação da porta `buscarPorSku`:
em vez de bater na API do ML, ela resolve pelo mapa `SKU → COR → item` montado na descoberta. Tudo
o que veio depois continua valendo, pelas mesmas razões do ADR-0104:

- `confirmar` (multiget) revalida cada irmão: seller, `variations` vazio, `family_id`,
  `user_product_id`, status remoto conhecido (`closed`/`under_review` → aborta);
- **`family_id` único** em todo o conjunto;
- **tudo-ou-nada**: 16 de 17 cores localizadas → **nada é gravado**, erro 400 com as contagens;
- **nenhum POST/PUT no ML durante o re-vínculo** — só `GET`. A reposição vem depois, pela saga UP.

### §5 — O re-apontamento alcança **todas** as famílias do mesmo `codigo_pai`

A RPC `adotar_familia_migrada_up` escopa o `update` de `variacoes.ml_variation_id` e de
`familias.ml_item_id` por `p_familia_id`. Isso é insuficiente: o mesmo `codigo_pai` costuma ter
**mais de uma** `familias` (uma por lote — no caso real, duas, ambas apontando para
`MLB4847766197`). Adotar só a do lote corrente deixaria a irmã apontando para um item dissolvido e
com `ml_variation_id` órfão — exatamente a atribuição de venda errada e silenciosa que o ADR-0104 §3
listou como motivo para nular o campo.

A RPC passa a receber **`p_ml_item_id_antigo`** e a aplicar as duas escritas a todas as famílias
`(org_id, codigo_pai)` **cujo `ml_item_id` é o antigo**. O filtro pelo id antigo é deliberado: uma
família do mesmo pai que aponte para outro anúncio (split, ADR-0048) **não** é tocada.

### §6 — `atualizarEstoque` (push rápido, ADR-0094) ganha o guard, não a adoção

`mercado-livre.ts:atualizarEstoque` faz `GET` → `PUT` **sem nenhum guard**: num anúncio dissolvido
ele escreve num item `closed` e devolve o erro cru do ML. Passa a chamar
`motivoAnuncioNaoAtualizavel` — mesma reutilização, mesma mensagem certa.

**O re-vínculo automático não entra no caminho rápido.** Ele é um push de estoque por valor
absoluto, deliberadamente fora do pipeline de UPDATE; embutir descoberta + adoção ali duplicaria a
orquestração. O caminho é: uma passada de **UPDATE** re-vincula a família, e a partir daí o push
rápido roteia pelos filhos UP normalmente. Fica registrado como limite conhecido.

### §7 — Fora de escopo, explicitamente

- **Cores novas na planilha** durante o re-vínculo: continuam de fora da adoção (ADR-0104 §2) e são
  criadas depois pela saga de composição.
- **Irmão fora da planilha** (o `'Rosa Bebê - 510'` real): continua não rastreado — limite conhecido
  do ADR-0104 §2, inalterado.
- **CREATE**: nada muda (ADR-0088 §3 já cobre).
- **Reconciliador administrativo** (`reconciliar-user-products`): segue como está.

## Alternativas consideradas

- **Casar por `variacoes.cor` (nosso banco) contra a cor do irmão**: rejeitada — §2. Nossas strings
  de cor não são as do ML.
- **Casar por posição/ordem dos irmãos**: rejeitada — a ordem de `?family_id=` é `stop_time_asc`, não
  tem relação com a ordem das variações do item morto. Seria adivinhação pura.
- **Usar `family_name` como filtro de busca**: rejeitada duas vezes — a API **ignora** o parâmetro, e
  como validação local ele assume um invariante ("o ML preserva o título") que só temos um caso para
  sustentar.
- **Descobrir pelo `catalog_product_id` do item morto**: rejeitada — é o produto de catálogo da
  família inteira, não distingue irmão, e nem todo item participa de catálogo.
- **Enumerar todos os itens do vendedor e indexar por `family_name`**: rejeitada — ~26 chamadas por
  tentativa contra 2 do `?q=`, para a mesma resposta, num worker de fila serial.
- **Manter o erro atual e re-vincular na mão**: rejeitada — Diego reportou que **todos** os anúncios
  serão migrados; isso converte cada família em trabalho manual.
- **Adoção parcial** (adotar as cores achadas e seguir): rejeitada pelos mesmos motivos do ADR-0104
  (falso-sucesso sobre conjunto incompleto).

## Consequências

- **Boas:** quando o ML dissolver uma família, o primeiro UPDATE re-vincula sozinho e o seguinte já
  roteia pelo atalho local. O operador não precisa perceber nada. O erro do lote #45 continua exato
  para anúncio de fato removido.
- **Riscos / tradeoffs aceitos:**
  - **A descoberta depende do `?q=` por título.** Título muito genérico pode trazer candidatos de
    outra família → aborta com os `family_id` observados (falha ruidosa, nunca adivinha).
  - **Um anúncio genuinamente encerrado paga 2 leituras a mais** antes da mensagem de sempre.
  - **O caminho rápido de estoque não re-vincula** (§6) — exige uma passada de UPDATE.
  - **Irmãos fora da planilha seguem não rastreados** (limite herdado do ADR-0104 §2).
  - **Cor ausente/duplicada entre os irmãos** aborta a adoção inteira. É a intenção: publicar estoque
    numa cor adivinhada é pior que falhar.
- **Como reverter:** o ramo novo em `atualizarAnuncio` volta a lançar 400 direto (uma condição), e a
  RPC volta ao escopo por `p_familia_id`. Nenhuma migration destrutiva; as linhas já adotadas
  continuam válidas e roteiam pelo atalho local.

## Validação (critérios de aceite)

- **Item `closed` sem `sub_status`, família descoberta, 17 cores casadas 1:1** → 1 raiz partição 0
  com `skus_esperados` de 17, 17 filhos, `ml_variation_id` nulado, `ml_item_id` re-apontado nas
  **duas** famílias do `codigo_pai`, **zero POST/PUT no ML durante o re-vínculo**.
- **`sub_status: ['deleted']`** → lança a mensagem de hoje **sem** nenhuma chamada de descoberta
  (RED-GREEN: o teste falha se a descoberta rodar).
- **`closed` mas nenhuma família encontrada** → lança **a mensagem original** do guard (lote #45).
- **`?q=` devolvendo dois `family_id` válidos** → aborta, nada gravado, ids na mensagem.
- **Cor do item morto sem irmão correspondente** → tudo-ou-nada aborta com as contagens.
- **Cor com dois irmãos vivos** → aborta (ambígua), nada gravado.
- **Irmão de outro vendedor / outra categoria** → descartado na validação.
- **Família do mesmo `codigo_pai` apontando para OUTRO `ml_item_id`** → **não** é re-apontada.
- **Segunda atualização** da família já adotada → atalho local, **sem** descoberta.
- **`atualizarEstoque` em item `closed`** → erro com a causa certa, sem PUT.
- **CI completo local antes do push**: `pnpm lint`, `deno lint`, `deno check`, `pnpm test`, `pnpm build`.
