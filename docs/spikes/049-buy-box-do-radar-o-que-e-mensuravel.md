# Spike 049 — O buy-box do Radar: o que é mensurável pela API do ML, e o que a D-4 não pode prometer

**Data:** 2026-08-29
**Pedido de Diego:** seguir para a implementação do Radar.
**Fecha as 3 perguntas abertas de** [`licoes-joompulse-para-o-radar.md`](../reference/licoes-joompulse-para-o-radar.md)
**ADR:** [0141](../decisions/0141-analise-publiai-joompulse-radar-e-sonar.md) D-4 e D-24 — **obriga emenda na D-4**

## Resposta curta

1. **A emenda "identificar por vendedor" da D-4 não resolve nada**, porque o problema nunca foi
   cobertura de fornecedor: é **opt-in de catálogo**. Os anúncios da org têm
   `catalog_listing: false` e por isso o `seller_id` dela **não aparece na ponte** — casar por
   vendedor em vez de por anúncio não muda um caso.
2. **AVIL tem 0 de 137 anúncios publicados em catálogo.** A célula "quem leva a venda, a org ou um
   rival" seria **estruturalmente vazia para o cliente real**.
3. **Existe ground truth de buy-box, mas só para anúncio próprio:**
   `GET /items/{item_id}/price_to_win` — 200 para item nosso, **403 para terceiro**.
4. **O ganhador de catálogo de terceiro não é obtenível.** `buy_box_winner` é null em 40/40, e todas
   as rotas alternativas fecham (tabela §4).
5. **Custo medido: 17 s** para os 229 catálogos com pool de 5 e cache frio → **é trabalho de
   coletor, não de abertura de página**.

---

## 1. O opt-in, não a cobertura — a emenda da D-4 morre aqui

A D-4 foi emendada pelo [Spike 039](039-joompulse-cobertura-medida.md) para identificar o ganhador
**por vendedor** (`buyBoxShopId` × `seller_id`), porque só ≈4% dos anúncios próprios estavam
indexados na JoomPulse e a comparação por anúncio faria a org "quase nunca aparecer como
ganhadora". A emenda tratava o sintoma como problema de **cobertura do fornecedor**.

**Medido — a causa é outra.** `GET /items?ids=…&attributes=catalog_listing` sobre os 156 anúncios
publicados das duas orgs:

| Org | publicados | `catalog_listing: true` | `false` |
|---|---:|---:|---:|
| **AVIL** | 137 | **0** | 137 |
| **DSA** | 19 | **1** | 18 |

A ponte `/products/{id}/items` lista **apenas anúncios de catálogo**. Com `catalog_listing: false`,
o anúncio da org não está lá — nem por `item_id`, nem por `seller_id`. Confirmado no caso concreto:
o `MLB7488452642` (nosso, `catalog_product_id: MLB19462147`, `catalog_listing: false`) **não
aparece** entre os 13 resultados da ponte daquele catálogo.

> **Casar por vendedor não conserta um problema de opt-in.** A emenda do Spike 039 estava certa
> sobre o efeito e errada sobre a causa, e por isso não entrega o que promete.

E os ≈4% do Spike 039 ganham explicação: os anúncios próprios não estavam sub-indexados na
JoomPulse — eles **não são anúncios de catálogo**.

## 2. O ground truth existe, e tem dono

`GET /items/{item_id}/price_to_win` devolve a competição de catálogo de verdade — campos `status`,
`price_to_win`, `visit_share`, `competitors_sharing_first_place`, `boosts`, `reason`.

| Chamada | Resultado |
|---|---|
| item **nosso**, `catalog_listing: true` | **200** — `{"status":"winning","current_price":124.9,"price_to_win":124,"competitors_sharing_first_place":0}` |
| item **nosso**, `catalog_listing: false` | 200, porém `{"status":"not_listed","reason":["item_not_opted_in"]}` — sem dado |
| item de **terceiro** | **403** — `"Item MLB7366894092 does not belong to caller 9757132"` |

**Este é o instrumento honesto do buy-box, e ele só enxerga a própria loja.** Para o único anúncio
de catálogo que a DSA tem, ele diz `winning` com `visit_share: "maximum"` — informação de decisão
de primeira qualidade, e indisponível para qualquer rival.

## 3. A hipótese "1º da ponte = ganhador" continua sem prova suficiente

Único caso com verdade fundamental disponível — `MLB7493485134`, catálogo `MLB2040647163`:

| | |
|---|---|
| `price_to_win` | `status: winning` |
| posição na ponte | **[0]** — primeiro |
| era também o mais barato? | **sim** (124,90 = menor) |

**1 de 1 a favor, mas o caso não discrimina as hipóteses:** sendo simultaneamente o primeiro e o
mais barato, ele é compatível com "a ordem é ranking" e com "a ordem é preço". E a única fonte de
verdade que temos exige `catalog_listing: true`, do qual só há **um** em toda a base.

Contra "a ordem é preço" existe a evidência do
[doc de lições](../reference/licoes-joompulse-para-o-radar.md) §2 — o 1º é o mais barato em só 9 de
17 catálogos disputados. Ou seja: a ordem **não é preço**, mas *que* ranking ela é permanece não
provado.

**Conclusão:** não há base para escrever "quem leva a venda é X" sobre catálogo de terceiro.

## 4. Matriz fechada — todas as rotas para o ganhador de terceiro

| Rota | Resultado |
|---|---|
| `/products/{id}` → `buy_box_winner` | **null em 40/40** (inclusive no catálogo onde há vencedor provado) |
| `/products/{id}?attributes=buy_box_winner` | null |
| `/products/{id}?include_attributes=all` | null |
| `/items/{id}` de terceiro | 403 (ADR-0119) |
| `/items?ids=` de terceiro | 403 (ADR-0143) |
| **`/items/{id}/price_to_win` de terceiro** | **403** |
| `/highlights/MLB/item/{id}` | 404 |
| `/highlights/MLB/catalog/{id}` | 404 |
| `/sites/MLB/search?catalog_product_id=` | 403 |
| campo `tier` nos itens da ponte | vazio em 166/166 |

`/products/{id}/items` é a **única** rota aberta, e entrega `seller_id`, `price`, `original_price`,
`shipping`, `official_store_id`, `listing_type_id`, `tags` e `paging.total`.

## 5. Custo e cobertura reais — a D-4 previa a arquitetura errada

A D-4 dimensionou **3 chamadas em lote de 75 ids** (CubeJS). Pela API do ML é **uma chamada por
catálogo**. Medido em 60 catálogos reais do Radar, pool de 5:

| | |
|---|---|
| latência por chamada | p50 **0,34 s**, p90 0,42 s, máx 0,66 s |
| throughput | **75 ms/catálogo** |
| **extrapolado para os 229 catálogos** | **≈17 s com cache frio** |

Universo por org: **AVIL 217 catálogos**, DSA 12.

**17 s é tempo de coletor, não de abertura de página** — ainda mais numa tela sem paginação
(`src/pages/Pulse.tsx:79`). O `pulse-coletar` já roda com o token e já itera catálogos; a ponte
pega carona a custo arquitetural quase zero. **Isso também dissolve a emenda da D-7**, que abria
exceção para "uma consulta em lote ao abrir a página do Radar".

### 22% dos catálogos não têm anúncio de catálogo ativo

Dos 60, **13 devolveram 404** em `/products/{id}/items`. Não é dado velho: `/products/{id}` responde
**200 com `status: active`** nos 13.

| `/products/{id}/items` | `/products/{id}` | n |
|---|---|---:|
| 200 | 200 `active` | 47 |
| **404** | **200 `active`** | **13** |

**É um estado legítimo — "catálogo existe, nenhum anúncio de catálogo ativo" — e merece texto
próprio na célula**, não "sem dado". A projeção de "~67% de linhas úteis" da ADR-0141 foi medida
contra a JoomPulse; pela API do ML o número é este.

## 6. Consequências para a ADR do Radar

**A D-24 sobrevive intacta e ganha confirmação em primeira mão.** O `/suggestions/items/{id}/details`
do `MLB7488452642` compara a nossa pomada de **50 ml** com apresentações de **49 g** e devolve
`lowest_price: 69,90` contra o nosso 72,47 — a Errata 10 da ADR-0119 reproduzida ao vivo. Sai da
tela.

**A D-4 não pode ser implementada como escrita.** O que resta mensurável, por catálogo:

- quantos anúncios de catálogo disputam (`paging.total`) — é o `numBuyBoxSellers` prometido;
- a faixa de preço da disputa (menor / mediana / maior);
- se a org disputa — hoje, **quase nunca**;
- quando a org disputa: `status`, `price_to_win` e `visit_share` **exatos**, via `price_to_win`.

O que **não** resta: dizer quem leva a venda quando a org não está no catálogo.

## 7. Não medido

- Se opt-in em catálogo é desejável para a AVIL — **decisão de negócio do Diego**, não de
  engenharia. Só se registra que hoje é 0 de 137.
- Qual ranking a ponte usa. Precisaria de mais de um anúncio próprio de catálogo para discriminar.
