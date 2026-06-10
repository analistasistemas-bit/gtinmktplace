# ADR-0021 — Vinculação automática ao Catálogo do ML (opt-in por variação)

**Status:** Aceito
**Data:** 2026-06-10
**Relacionados:** refina ADR-0005/0016 (lifecycle CREATE/UPDATE); coexiste com ADR-0003 (variações agrupadas) e ADR-0014 (busca de concorrência por GTIN).

## Contexto

O Mercado Livre passou a **exigir catálogo** nos domínios de aviamentos (`catalog_required`).
Anúncios que não competem no catálogo recebem a tag `catalog_forewarning` e, após a data-limite,
são **pausados** pela moderação `OPT_OBEY`. O operador vinha vinculando cada cor manualmente no
painel do ML ("Busque sua variação para competir").

## Validação com token real (2026-06-10, conta AVILBV)

- **`catalog_only`: NÃO** para fita (`MLB-HABERDASHERY_RIBBONS`) nem linha
  (`MLB-SEWING_AND_CRAFT_THREADS`) — só 11 domínios são `catalog_only`, todos
  eletrônicos/medicamentos. **Consequência:** o opt-in **não inativa** o anúncio de marketplace
  (risco principal descartado).
- **`catalog_required`: SIM** para linha/fita/botão — a exigência é estrutural.
- **`GET /products/search?status=active&site_id=MLB&product_identifier={gtin}`** retorna o
  produto de catálogo **exato** por GTIN real (1 resultado, com `parent_id` e
  `settings.listing_strategy`).
- **`GET /items/{id}/catalog_listing_eligibility`** decide **por variação**:
  - anúncio com cores da **mesma família** de catálogo → `READY_FOR_OPTIN` / `buy_box_eligible`;
  - anúncio que agrupa cores de **famílias diferentes** → `FAMILY_DIFF`
    (`variation_belongs_to_different_family`), **bloqueado**.
- **Opt-in:** `POST /items/catalog_listings` com `{item_id, variation_id, catalog_product_id}`
  (um POST por variação). Cria um anúncio de catálogo **paralelo**; o agrupado original permanece
  (sincronização de preço/estoque automática via `item_relations`).

## Decisão

Automatizar a vinculação ao catálogo **no fluxo de publicação** (CREATE e UPDATE), de forma
**automática** (sem confirmação na Revisão) e **híbrida por confiança**:

1. **Match só por GTIN real** (`product_identifier`). GTIN nulo/`3000*` → sem match (nunca
   casa por texto — evita associar à ficha errada).
2. **Trava de elegibilidade:** só faz opt-in de variação `READY_FOR_OPTIN` + `buy_box_eligible`.
   `FAMILY_DIFF`/`NOT_ELIGIBLE`/sem match → registra o status, **não** força.
3. **Best-effort, pós-publicação:** o passo roda depois de o item já estar persistido
   (`ml_item_id`) e as variações casadas (`ml_variation_id`). Falha por variação não derruba o
   anúncio; um retry reentra só no que falta.
4. **Idempotência:** variação com `catalog_listing_id` é pulada (o opt-in cria recurso novo, não
   é naturalmente idempotente); a elegibilidade é relida a cada execução.

### Modelo de dados (migration aditiva)

Em `variacoes`: `catalog_product_id`, `catalog_listing_id`, `catalog_status`
(`pendente|vinculado|sem_produto|family_diff|nao_elegivel|erro`), `catalog_erro`.

### Código

- `_shared/ml/catalogo.ts` — puras (`decidirAcaoCatalogo`, `montarBodyOptin`,
  `indexarEligibility`) + rede (`buscarProdutoCatalogoPorGtin`, `buscarElegibilidadeCatalogo`,
  `optinCatalogo`) + orquestrador `vincularVariacoesCatalogo`.
- `publish-familia-ml` (CREATE) e `update-familia-ml` (UPDATE) chamam o orquestrador no fim.

## Consequências

- Anúncios de cores **da mesma família** passam a competir no catálogo automaticamente,
  removendo a ameaça de pausa para essas variações.
- Anúncios multi-cor grandes (cores de famílias diferentes) ficam `FAMILY_DIFF` — **não**
  vinculáveis sem separar o anúncio (conflita com ADR-0003; **fora de escopo**). O sistema
  reporta o status por cor em vez de forçar.
- O anúncio de marketplace agrupado **sobrevive** (domínios não são `catalog_only`).

## Fora de escopo / pendências

- **Resgate em massa** dos já-publicados (operador faz manual no painel do ML — decisão do
  brainstorming). O código novo só atua em publicações futuras (CREATE/UPDATE).
- **Marcar "sem produto" no ML** para cores sem match (preemptar a ameaça): o endpoint/body não
  está confirmado na doc; por ora fica registrado como `catalog_status='sem_produto'` no banco.
  Vira follow-up quando o endpoint for validado com token real.
- **Separar anúncios `FAMILY_DIFF`** por família de catálogo (mudança estrutural; conflita com
  ADR-0003).
