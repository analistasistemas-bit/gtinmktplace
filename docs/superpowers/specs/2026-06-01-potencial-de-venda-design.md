# Card "Potencial de venda" no painel de análise — Design

**Data:** 2026-06-01
**Autor:** Diego (brainstorming) + agente
**Status:** Aprovado (design)
**ADR:** [ADR-0015](../../decisions/0015-potencial-de-venda-via-proxies.md)
**Relacionado:** estende [ADR-0014](../../decisions/0014-busca-de-concorrencia.md) e o painel de análise (spec `2026-06-01-painel-analise-revisao-design.md`)

## Problema

O operador precisa decidir, na revisão, **se vale a pena vender um produto no ML**. A venda exata
por produto não é exposta pela API (ver ADR-0015). Trazemos **proxies** reais ao painel.

## Objetivo

Um card visual **"Potencial de venda"** no `PainelAnalise`, ao lado de Concorrência, com 6
indicadores (faixa de preço, frete grátis, FULL, força dos concorrentes, ranking, idade).

## Fontes de dados (todas validadas na API, 2026-06-01)

| Indicador | Fonte | Campo |
|---|---|---|
| Faixa de preço | `/products/{id}/items` (já buscado) | `price` (min/max) |
| Frete grátis | idem | `shipping.free_shipping` |
| Logística FULL | idem | `shipping.logistic_type == 'fulfillment'` |
| Total de ofertas | idem | nº de `results` |
| Força concorrentes | `/users/{seller_id}` (novo) | `power_seller_status`, `seller_reputation.transactions.total` |
| Ranking categoria | `/highlights/MLB/category/{cat}` (novo) | posição do `product_id` |
| Idade no catálogo | `/products/{id}` (novo) | `date_created` |

## Arquitetura (backend)

### `_shared/concorrencia/parse.ts` (estender)

`parseItensProduto` passa a retornar também os dados extras das ofertas:

```ts
export interface DadosOfertas {
  vendedores: number;       // sellers distintos (já existia)
  preco_min: number | null; // já existia
  preco_max: number | null; // novo
  total_ofertas: number;    // novo: nº de results
  frete_gratis: number;     // novo: count free_shipping === true
  full: number;             // novo: count logistic_type === 'fulfillment'
  seller_ids: number[];     // novo: ids distintos para reputação
}
```

(Funções puras testáveis. Mantém compatibilidade: `buscarConcorrencia` continua derivando
`vendedores`/`preco_min` daqui.)

### `_shared/ml/concorrencia.ts` (estender)

`buscarConcorrencia` passa a expor, no `ResultadoConcorrencia`, dois campos opcionais para o
orquestrador consumir sem refazer chamadas:

```ts
product_id?: string | null;   // do /products/search (ramo gtin)
ofertas?: DadosOfertas;        // do /products/{id}/items
```

### `_shared/ml/mercado.ts` (criar)

```ts
export interface AnaliseMercado {
  preco_max: number | null;
  total_ofertas: number;
  frete_gratis: number;
  full: number;
  lideres: number;
  maior_vendas: number;
  ranking_categoria: number | null;
  produto_desde: string | null; // 'YYYY-MM-DD'
}

export async function analisarMercado(
  userId: string,
  productId: string,
  categoriaMlId: string | null,
  ofertas: DadosOfertas,
): Promise<AnaliseMercado>
```

Passos (todos resilientes — erro → campo ausente/zero, nunca lança):
1. Reputação: para cada `seller_id` distinto, `getReputacaoVendedor(userId, sellerId)` com cache
   `cache:seller:{id}` (TTL 24h) → `{ lider: boolean, vendas: number }`. Agrega via função pura
   `agregarMercado(reputacoes)` → `{ lideres, maior_vendas }`.
2. Ranking: `getHighlightsCategoria(userId, categoriaMlId)` com cache `cache:highlights:{cat}`
   (TTL 6h) → JSON; função pura `posicaoNoRanking(json, productId)` → `number | null`.
3. Idade: `/products/{id}` → `date_created` (fatiar para `YYYY-MM-DD`).
4. Campos de oferta (`preco_max`, `total_ofertas`, `frete_gratis`, `full`) vêm de `ofertas`.

### Funções puras com TDD

- `parseItensProduto` (estendida) — testes para min/max, contagem de frete/FULL, sellers distintos.
- `agregarMercado(reputacoes: {lider, vendas}[])` → `{lideres, maior_vendas}`.
- `posicaoNoRanking(highlightsJson, productId)` → `number | null`.

`analisarMercado`, `getReputacaoVendedor`, `getHighlightsCategoria` fazem I/O → validadas no bug
bash, sem teste unitário (padrão do projeto, igual `buscarConcorrencia`).

### Integração no `process-familia`

Após `buscarConcorrencia`, se `origem === 'gtin'` e há `product_id`:
```ts
const analise = await analisarMercado(userId, concorrencia.product_id, categoriaMlId, concorrencia.ofertas);
```
Persistir `analise_mercado: analise` no update final da família. Sem concorrência por GTIN →
`analise_mercado: null`.

## Schema (migration aditiva)

`alter table familias add column analise_mercado jsonb;` (nullable). Regenerar tipos. Estrutura
do JSON = `AnaliseMercado` acima.

## Frontend

- `tipos-dominio.ts`: `Familia` ganha `analiseMercado: AnaliseMercado | null` (espelho do tipo,
  em camelCase mínimo — manter os nomes dos campos do jsonb).
- `queries.ts`: `familiaFromRow` mapeia `r.analise_mercado` (cast do jsonb) → `analiseMercado`.
- `painel-analise.tsx`: novo card "Potencial de venda" (ícone `TrendingUp`), exibido só quando
  `familia.analiseMercado != null`. Linhas:
  - 💲 Preço concorrentes: `R$ min – R$ max` (usa `concorrenciaPrecoMin` + `analiseMercado.preco_max`)
  - 📈 Força: `{lideres}/{concorrenciaVendedores} MercadoLíder · maior {maior_vendas abreviado} vendas`
    (denominador = vendedores distintos, pois "líder" é propriedade do vendedor)
  - 🚚 Frete grátis: `{frete_gratis}/{total_ofertas}` · ⚡ FULL: `{full}/{total_ofertas}`
    (denominador = ofertas, pois frete/logística são por anúncio)
  - 🏆 Ranking: `#{ranking_categoria} na categoria` ou `fora do top`
  - 📅 No catálogo desde `{produto_desde formatado}`
  - Helper `fmtMilhar(n)` → "52 mil" / "1,2 mi" (abreviação pt-BR) para `maior_vendas`.
- Teste de componente cobrindo: card presente com dados; ausência quando `analiseMercado` null;
  ranking nulo → "fora do top".

## Cache e rate-limit

Cache de seller (24h) e categoria (6h) reduz o volume em lotes grandes (vendedores e categorias
se repetem). ~6–9 sellers por produto. Aceitável.

## Fora de escopo

- Venda exata por produto (API não expõe — ADR-0015).
- Nº de avaliações/nota (403).
- Alterar a regra de preço (ADR-0008) — os proxies são informativos.
- Mexer no `FamiliaRow` colapsado.
