# ADR-0015 — Potencial de venda via proxies (a API do ML não expõe venda por produto)

**Status:** Aceito
**Data:** 2026-06-01
**Decisores:** Diego (decisões de produto)
**Relacionado:** estende a análise de [ADR-0014 (busca de concorrência)](0014-busca-de-concorrencia.md); alimenta a tela de Revisão (painel de análise)

## Contexto

O operador precisa decidir, na revisão, **se vale a pena vender um produto no Mercado Livre**.
A informação mais direta seria a **quantidade vendida do produto**, que o ML mostra na própria
tela do anúncio ("+50 vendidos"). Diego pediu para trazer isso ao painel de análise.

**Investigação na API (2026-06-01, token de produção AVILBV) — o que está disponível:**

| Fonte | Resultado |
|---|---|
| `sold_quantity` em `/products/{id}/items` e `buy_box_winner` | ❌ **null** (ML ofuscou por privacidade) |
| `/items/{id}` de terceiros | ❌ **403** (access_denied) |
| `/reviews/item/{id}` (avaliações do produto) | ❌ **403** (PolicyAgent) |
| `rating_average`/`reviews` em `/products/{id}` | ❌ **null** |
| `/users/{seller_id}` (reputação do vendedor) | ✅ `seller_reputation.transactions.total` + `power_seller_status` |
| `/highlights/MLB/category/{cat}` (ranking best-seller) | ✅ top ~9 produtos por categoria |
| `/products/{id}/items` (preço, frete, logística por oferta) | ✅ campos `price`, `shipping.free_shipping`, `shipping.logistic_type`, `listing_type_id` |
| `/products/{id}` → `date_created` | ✅ idade do produto no catálogo |

**Conclusão:** a venda exata **por produto** não é acessível via API para apps. O "+10 mil
vendas" visível na tela do ML é a **reputação do vendedor** (transações totais dele em tudo),
que a API expõe — não a venda daquele produto.

## Decisão

Como a venda por produto não existe na API, o painel de análise usa **proxies** combinados para
estimar o "potencial de venda" — todos obtidos de fontes reais:

1. **Faixa de preço dos concorrentes** — menor e maior preço das ofertas (`/products/{id}/items`).
   Mostra margem de manobra e posicionamento do nosso preço.
2. **Frete grátis** — quantas das ofertas oferecem frete grátis. Se a maioria dá, é praticamente
   requisito competitivo e afeta a margem.
3. **Logística FULL** — quantas ofertas usam Mercado Envios FULL (`logistic_type == 'fulfillment'`),
   que converte mais. Indica o nível de profissionalização da disputa.
4. **Força dos concorrentes** — quantos vendedores são MercadoLíder (`power_seller_status` não
   nulo) e a maior reputação de vendas entre eles (`/users/{seller_id}`). Vendedores fortes
   disputando = mercado ativo e comprador.
5. **Ranking na categoria** — posição do produto no best-seller da categoria (`/highlights`), ou
   "fora do top". Sinal de demanda por categoria.
6. **Idade no catálogo** — `date_created` do produto. Mercado maduro vs recém-criado.

Todos os indicadores são **informativos** (ajudam a decisão humana); **nenhum** altera preço ou
bloqueia publicação. Disponíveis apenas quando há concorrência por GTIN (origem=`gtin` com
produto de catálogo encontrado); senão o painel não exibe o card.

## Alternativas consideradas

- **Mostrar a venda exata do produto:** impossível — API retorna null. Rejeitada por inviabilidade.
- **Usar nº de avaliações como proxy de vendas:** seria bom, mas `/reviews` retorna 403. Rejeitada.
- **Não implementar nada (a venda não existe):** descarta valor real disponível (preço, frete,
   FULL, reputação, ranking). Rejeitada — os proxies respondem bem à pergunta de negócio.
- **Reputação do vendedor como "vendas do produto":** seria enganoso (é o total do vendedor).
   Mantida apenas rotulada honestamente como "força dos concorrentes", não como venda do produto.

## Modelo de dados

Uma coluna **`analise_mercado jsonb`** (nullable) em `familias` — agrupa os proxies novos sem
poluir o schema com ~8 colunas (o projeto já usa jsonb em `atributos_ml`/`sale_terms`). Os campos
`concorrencia_*` existentes (vendedores, preco_min, origem, classe) permanecem.

```json
{
  "preco_max": 17.02,
  "total_ofertas": 8,
  "frete_gratis": 0,
  "full": 0,
  "lideres": 4,
  "maior_vendas": 52665,
  "ranking_categoria": null,
  "produto_desde": "2024-03-05"
}
```

`null`/ausência de campo = dado indisponível (degradação silenciosa).

## Cache (Upstash Redis)

- `cache:seller:{seller_id}` (reputação) — TTL 24h (muda devagar; reusado entre famílias/lotes).
- `cache:highlights:{categoria}` (ranking) — TTL 6h (reusado por categoria).
- O produto (`/products/{id}` para `date_created`) reaproveita a busca já feita em
  `buscarConcorrencia` quando possível; quando precisar de chamada própria, sem cache dedicado
  no MVP (1 chamada barata por família).

## Resiliência

Qualquer erro/timeout/403 em qualquer fonte → o campo correspondente fica ausente/`null` e o
restante do painel segue. `analisarMercado` **nunca** derruba o `process-familia` (mesma regra do
ADR-0014). Sem concorrência por GTIN → `analise_mercado` fica `null`.

## Consequências

**Boas:**
- Responde à pergunta de negócio ("vale a pena vender?") com o melhor sinal disponível.
- Faixa de preço, frete e FULL saem do request de ofertas que já fazemos (custo zero de API).
- jsonb único mantém o schema enxuto e fácil de evoluir.

**Tradeoffs aceitos:**
- Não é a venda real do produto — é um conjunto de proxies; rotulado honestamente na UI.
- Reputação e ranking custam chamadas extras por família — mitigado por cache (seller/categoria).
- jsonb é menos tipado que colunas; aceitável porque os campos são exibidos juntos, não filtrados.

## Como reverter

A análise vive em `_shared/ml/mercado.ts` + funções puras. Para desligar, o `process-familia`
deixa de chamá-la (`analise_mercado` fica null, o card some). Trocar/adicionar proxies é
localizado nessa função e no parse das ofertas.
