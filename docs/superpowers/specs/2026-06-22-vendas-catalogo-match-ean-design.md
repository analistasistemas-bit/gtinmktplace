# Spec — Atribuir vendas de catálogo ao produto do PubliAI por EAN

**Data:** 2026-06-22
**ADR relacionado:** 0037
**Status:** aprovado para implementação

## Problema

No detalhe de vendas (menu Publicado), toda venda cujo `item.id` (MLB) não está em
`familias.ml_item_id` cai no balde **"Fora do PubliAI"**. O match é feito **apenas por MLB**
(`_shared/ml/vendas.ts:47`).

Quando um produto vende pelo **catálogo do Mercado Livre**, a venda entra com o MLB do
anúncio âncora do catálogo (não o MLB do anúncio do usuário). Resultado: produtos que são do
usuário, publicados pelo PubliAI, aparecem como "Fora do PubliAI". No print de referência,
apenas o "Kit Pistola de Cola Quente" foi de fato publicado direto fora do app; as fitas de
cetim foram vendas de catálogo dos produtos do próprio usuário.

## Objetivo

Usar o **EAN/GTIN** como segundo critério de atribuição: se um item "externo" tem GTIN igual
ao de uma variação do usuário, a venda é atribuída ao anúncio PubliAI dono daquele GTIN e
**somada na linha desse produto** — saindo de "Fora do PubliAI".

Catálogo do ML é, por definição, o mesmo produto (mesmo GTIN), então o cruzamento por GTIN é
correto e seguro.

## Não-objetivos

- Não mudar os KPIs do topo (`totais` já somam toda a conta do vendedor — ADR-0032).
- Não criar linha separada "via catálogo": a venda é absorvida na linha do produto (decisão do
  usuário).
- Não mexer no frontend além do que o pipeline já entrega.

## Design

### Fluxo atual
```
metricas-vendas/index.ts  → escopo = familias.ml_item_id
  → conn.lerMetricasVendas(ctx, intervalo, ids)
    → lerVendasML(token, intervalo, ids)
      → agregarPedidos(pedidos, escopo)  → porItem | porItemExterno (match só por MLB)
      → buscarTitulos(externos)          → /items?attributes=id,title
```

### Mudanças

**1. `metricas-vendas/index.ts`** — além dos `ml_item_id`, monta `mapaGtin: Record<gtin,
ml_item_id>` consultando `variacoes` (gtin) join `familias` (id → ml_item_id) do usuário.
Cada GTIN aponta para o MLB da família dona dele. GTIN nulo é ignorado. Passa o mapa ao
conector.

**2. `contrato.ts` / `mercado-livre.ts`** — `lerMetricasVendas` ganha 4º parâmetro opcional
`mapaGtin?: Record<string,string>`. Retrocompatível (default `{}`).

**3. `_shared/ml/vendas.ts`** — núcleo:
   - `buscarTitulos` passa a buscar `attributes=id,title,attributes` e devolver, além do
     título, o **GTIN** de cada item externo (helper `extrairGtin` lê o atributo de id `GTIN`,
     fallback `EAN`). 1 chamada — sem custo extra de rede.
   - Nova função **pura** `reclassificarPorGtin(porItem, porItemExterno, gtinPorItem, mapaGtin)`:
     para cada item externo cujo GTIN ∈ `mapaGtin`, **soma** `unidades`/`valor` em
     `porItem[mapaGtin[gtin]]` (criando a entrada se necessário) e remove de `porItemExterno`.
     Os demais permanecem externos.
   - `lerVendasML` chama `reclassificarPorGtin` antes de `montarExternos`.

**4. Frontend** — **inalterado**. `montarDetalheVendas` já casa `porItem` com `publicados`
por `mlItemId`, então a venda reclassificada aparece na linha do produto (título/código/EAN)
dentro de "Seus anúncios (PubliAI)".

### Contratos das funções puras

```ts
// gtinPorItem: itemExternoId → GTIN (ou ausente se a API não trouxe)
// mapaGtin: GTIN → ml_item_id do usuário
function reclassificarPorGtin(
  porItem: Record<string, {unidades:number; valor:number}>,
  porItemExterno: Record<string, {unidades:number; valor:number}>,
  gtinPorItem: Record<string, string>,
  mapaGtin: Record<string, string>,
): { porItem: ...; porItemExterno: ... }  // novos objetos, sem mutar entrada
```

## Casos de teste (TDD)

`reclassificarPorGtin` (pura):
1. Item externo com GTIN que casa → some em `porItem` sob o ml_item_id certo, sai do externo.
2. Soma sobre entrada existente em `porItem` (produto teve venda direta + catálogo).
3. GTIN que não casa → continua externo.
4. Item externo sem GTIN (não veio na API) → continua externo.
5. Dois itens externos com o mesmo GTIN → ambos somam no mesmo ml_item_id.
6. Não muta os objetos de entrada.

`extrairGtin` (pura): lê atributo `GTIN`; fallback `EAN`; retorna undefined se ausente.

## Efeitos esperados

- KPIs do topo: **iguais** (totais não mudam).
- Pistola de Cola (sem ficha PubliAI → GTIN não casa): **continua** em "Fora do PubliAI".
- Fitas de cetim (catálogo dos produtos do usuário): **migram** para a linha do produto.

## Riscos e mitigação

- Item de catálogo sem atributo GTIN na resposta da API → fica externo (degradação segura,
  sem erro).
- GTIN repetido em famílias diferentes: verificado em produção (2026-06-22) — 814 GTINs, zero
  apontando para mais de um `ml_item_id`. As repetições são linhas de `familias` duplicadas
  para o mesmo MLB, então o mapa resolve sempre para o mesmo anúncio. Sem atribuição cruzada.
