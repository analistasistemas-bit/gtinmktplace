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
3. **Deferido via QStash (NÃO síncrono no publish):** a elegibilidade de catálogo do ML **não
   está pronta no instante do `POST /items`** — leva alguns minutos, e ainda passa por estados
   **transitórios** (um anúncio multi-cor de famílias diferentes pode aparecer `READY_FOR_OPTIN`
   por instantes e depois assentar em `FAMILY_DIFF`). Rodar síncrono marcaria tudo como não
   elegível (bug pego no bug bash do lote 25: 79/79 → `nao_elegivel` no publish; minutos depois,
   `READY`/`FAMILY_DIFF`). Por isso o `publish`/`update` apenas **enfileiram** um job
   `vincular-catalogo` com **delay (10 min, p/ a elegibilidade assentar) + retries**; o worker
   roda o orquestrador. Enquanto houver variação `pendente` (ainda computando), devolve 500 e o
   QStash retenta.
4. **Idempotência:** variação com `catalog_listing_id` é pulada (o opt-in cria recurso novo, não
   é naturalmente idempotente); a elegibilidade é relida a cada execução.
5. **`pendente` ≠ `nao_elegivel`:** elegibilidade ausente/sem status = ainda computando → estado
   retentável `pendente`. `nao_elegivel` só quando o ML devolve status explícito não-elegível.

### Modelo de dados (migration aditiva)

Em `variacoes`: `catalog_product_id`, `catalog_listing_id`, `catalog_status`
(`pendente|vinculado|sem_produto|family_diff|nao_elegivel|erro`), `catalog_erro`.

### Código

- `_shared/ml/catalogo.ts` — puras (`decidirAcaoCatalogo`, `montarBodyOptin`,
  `indexarEligibility`) + rede (`buscarProdutoCatalogoPorGtin`, `buscarElegibilidadeCatalogo`,
  `optinCatalogo`) + orquestrador `vincularVariacoesCatalogo`.
- `vincular-catalogo` (worker QStash) roda o orquestrador; 500 enquanto `pendente`.
- `_shared/queue.ts` → `enfileirarVinculacaoCatalogo(familiaId, delay=600s, retries=5)`.
- `publish-familia-ml` (CREATE) e `update-familia-ml` (UPDATE) **enfileiram** o job no fim
  (não rodam o opt-in síncrono).

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

## Revisão pós-incidente (2026-06-15) — trava de equivalência

**Incidente:** um cliente comprou pelo catálogo um anúncio nosso de **1 rolo** que estava
vinculado à ficha `MLB25284234` = *"Fita... Verde Menta... **Kit 5 Unidades**"*. A varredura das
3 famílias com catálogo achou **19 vinculações erradas**: 17 fichas `SALE_FORMAT=Kit /
UNITS_PER_PACK=5` (fita N.3), 1 ficha `UNITS_PER_PACK=10` (linha "10 cones") e 1 de dimensão
divergente (Cacau → ficha 22mm×50m). Os 19 foram **pausados** no ML (contenção) e seguem para
close+delete.

**Causa raiz:** a premissa do passo 1 da Decisão — *"match só por GTIN real → ficha equivalente"*
— é **falsa**. O catálogo do ML tem fichas de **kit** e de **dimensão diferente** carregando o
GTIN da unidade avulsa; o ML ainda devolve `READY_FOR_OPTIN`/`buy_box_eligible` para elas. Pior:
o **título engana** (fichas-kit sem "kit"/"5" no nome); a verdade está nos atributos estruturados.

**Decisão adicional:** antes de cada opt-in, `fichaEquivalente` confronta os atributos da ficha
(que `/products/search` já devolve inline — sem chamada extra) com o nosso produto:

1. **Anti-kit (forte, dado limpo):** `UNITS_PER_PACK > 1` **ou** `SALE_FORMAT ≠ "Unidade"` → não vincula.
2. **Metragem:** compara `LENGTH` da ficha com o `LENGTH` do nosso item (lido 1× por item), só
   quando ambos são plausíveis (≥ 1 m), com tolerância de ±25%. Pega o caso de dimensão (10m vs 50m).
3. **`WIDTH` ficou de fora:** é dado sujo nos dois lados (nosso item publica `2.2 cm` para uma fita
   de 15mm; fichas variam entre `1.5 cm` e `22 cm`) — compará-lo geraria falso-positivo em massa.

Ficha reprovada → novo estado `catalog_status='ficha_divergente'` (migration aditiva), com o
motivo em `catalog_erro`. Quando a avaliação não pôde ser feita, o comportamento anterior é
preservado (não bloqueia). **Follow-up:** corrigir o atributo `WIDTH` dos nossos itens (publicação)
para reabilitar a trava de largura.
