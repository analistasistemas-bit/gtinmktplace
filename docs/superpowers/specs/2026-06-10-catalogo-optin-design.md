# Design — Vinculação automática ao Catálogo do ML (opt-in por variação)

**Data:** 2026-06-10
**Status:** aprovado (brainstorming + validação com token real)
**ADR relacionado:** ADR-0021 (novo) — coexiste com ADR-0003 (variações agrupadas), ADR-0005/0016 (lifecycle CREATE/UPDATE), ADR-0014 (busca de concorrência).

## Problema

O ML está ameaçando pausar anúncios que não competem no **Catálogo** (tag `catalog_forewarning`,
moderação `OPT_OBEY`). A mensagem "Verifique o produto de catálogo... antes de [data]" e
"Busque sua variação para competir" aparece porque os domínios de aviamentos são
**`catalog_required`**. Hoje o operador precisa vincular cada cor manualmente no painel do ML.

## Validação com token real (2026-06-10, conta AVILBV)

Edge de sondagem descartável (`probe-catalogo`, removida após o estudo) contra a API real:

1. **`catalog_only`: NÃO** para fita (`MLB-HABERDASHERY_RIBBONS`) nem linha
   (`MLB-SEWING_AND_CRAFT_THREADS`). Logo o opt-in **não inativa** o anúncio de marketplace
   (o maior risco — descartado). Só 11 domínios são `catalog_only`, todos eletrônicos/medicamentos.
2. **`catalog_required`: SIM** para linha/fita (e botão). A ameaça é estrutural e recorrente.
3. **`GET /products/search?status=active&site_id=MLB&product_identifier={gtin}`** retorna o
   produto de catálogo **exato** da cor (1 resultado, com `parent_id`, `settings.listing_strategy`).
   Casamento por GTIN é confiável.
4. **`GET /items/{id}/catalog_listing_eligibility`** é o portão decisivo, **por variação**:
   - Item de **linha (2–3 cores da mesma família)** → todas `READY_FOR_OPTIN`, `buy_box_eligible: true`.
   - Item de **fita (74 cores de famílias diferentes)** → todas `FAMILY_DIFF`
     (`variation_belongs_to_different_family`), `buy_box_eligible: false`.
   - **Conclusão:** o opt-in só funciona quando as cores agrupadas resolvem para a **mesma
     família de catálogo**. Anúncio que mistura muitas famílias é reprovado em bloco e só
     seria vinculável separando o anúncio (conflita com ADR-0003; fora de escopo).
5. **Opt-in** = `POST /items/catalog_listings` com `{item_id, variation_id, catalog_product_id}`
   (um POST por variação). Cria um anúncio de catálogo **paralelo**; o agrupado original
   permanece (sincronização de preço/estoque automática via `item_relations`).

## Decisões do operador (brainstorming)

- **Estratégia:** híbrida por confiança — opt-in só em match de **GTIN real** (nunca por texto).
- **Escopo:** só **automação futura** (CREATE/UPDATE); os já-publicados o operador resgata
  manualmente no painel do ML.
- **Confirmação:** **automática no publish** (sem checkbox), travada por confiança alta +
  elegibilidade.
- **Sem match:** registrar status; quando confirmado o endpoint, marcar "sem produto".

## Arquitetura

### Modelo de dados (migration aditiva — ADR-0021)

Em `variacoes`:
- `catalog_product_id text` — produto de catálogo casado por GTIN real (null = sem match).
- `catalog_listing_id text` — MLB do anúncio de catálogo paralelo criado pelo opt-in
  (**chave de idempotência**: já setado → nunca reposta).
- `catalog_status text` — enum textual:
  `pendente | vinculado | sem_produto | family_diff | nao_elegivel | erro`.
- `catalog_erro text` — última mensagem de erro do opt-in (diagnóstico).

### `_shared/ml/catalogo.ts` (novo) — funções puras + chamadas de API

Puras (TDD):
- `decidirAcaoCatalogo(variacao, eligibilityVar) → 'optin' | 'sem_produto' | 'family_diff' | 'nao_elegivel' | 'pula'`
  - já vinculada (`catalog_listing_id`) → `'pula'`
  - sem `catalog_product_id` (sem GTIN real/sem match) → `'sem_produto'`
  - eligibility da variação `READY_FOR_OPTIN` + `buy_box_eligible` → `'optin'`
  - eligibility `FAMILY_DIFF` → `'family_diff'`
  - demais (`NOT_ELIGIBLE`, ausente) → `'nao_elegivel'`
- `montarBodyOptin(itemId, variationId, catalogProductId) → { item_id, variation_id, catalog_product_id }`
- `indexarEligibility(eligibilityBody) → Map<variationId, EligVar>`

API (resiliente, timeouts):
- `buscarProdutoCatalogoPorGtin(token, gtin) → catalog_product_id | null` (reusa cache por GTIN).
- `buscarElegibilidade(token, itemId) → EligibilityBody | null`.
- `optinCatalogo(token, body) → { catalog_listing_id } | erro` (trata 4xx por variação sem derrubar).

### Matching — `process-familia` (estende ADR-0014)

Hoje: 1 busca de concorrência por família. Passa a, **por variação com GTIN real**, resolver e
persistir `variacoes.catalog_product_id` via `buscarProdutoCatalogoPorGtin` (cache por GTIN
reaproveitado). GTIN nulo/`3000*`/busca vazia → `catalog_product_id = null`. Sem custo de IA.

### CREATE — `publish-familia-ml` (pós-criação do item)

Depois de criar o item agrupado e casar `ml_variation_id` (como hoje), roda o **passo de catálogo**:
1. `buscarElegibilidade(item_id)` → indexa por `variation_id`.
2. Para cada variação publicada:
   - `decidirAcaoCatalogo` → `optin`: `POST /items/catalog_listings`; grava `catalog_listing_id`,
     `catalog_status='vinculado'`.
   - `sem_produto` / `family_diff` / `nao_elegivel`: grava só o `catalog_status` (sem chamada).
   - `pula`: idempotência (retry) — não reposta.
3. Erros por variável **não derrubam** o anúncio (já publicado): grava `catalog_erro` +
   `catalog_status='erro'` e segue. O passo de catálogo é **best-effort** e roda após o item já
   estar persistido (`ml_item_id`), então um retry posterior reentra só no que falta.

### UPDATE — `update-familia-ml`

- Reposição pura: variações já `vinculado` não são tocadas (ML sincroniza sozinho).
- Cor nova / variação ainda não vinculada / `catalog_status in (erro, pendente)`: roda o mesmo
  passo (eligibility + opt-in) para reconciliar.

## Idempotência

- `catalog_listing_id` setado ⇒ variação já vinculada ⇒ pula (o opt-in cria recurso novo, não é
  naturalmente idempotente; a guarda local evita duplicar).
- Sempre relê eligibility antes do POST (status pode ter mudado entre tentativas).

## Erros conhecidos (tratados)

`4400`/`4402` (produto inativo / faltando) → `catalog_status='erro'`; `417`/`418` (id incoerente)
→ `erro`; `216` (variação sem `variation_id`) → nunca ocorre (sempre enviamos). Nenhum derruba o
anúncio.

## Fora de escopo (YAGNI)

- Resgate em massa dos já-publicados (operador faz manual; decisão do brainstorming).
- Separar anúncios `FAMILY_DIFF` em itens por família de catálogo (conflita com ADR-0003).
- Marcar "sem produto" no ML: o endpoint/body não está confirmado na doc; fica registrado como
  `catalog_status='sem_produto'` no banco e a marcação ML vira follow-up quando validado o endpoint.
- UI de catálogo na Revisão (opt-in é automático, sem confirmação).

## Testes (TDD)

Funções puras em `_shared/ml/__tests__/catalogo.test.ts`:
- `decidirAcaoCatalogo` em todos os ramos (já vinculada, sem match, READY, FAMILY_DIFF, NOT_ELIGIBLE).
- `montarBodyOptin` (shape correto).
- `indexarEligibility` (mapa por variation_id; corpo vazio/nulo → mapa vazio).

## Riscos residuais

- `FAMILY_DIFF` é o caso comum nos anúncios multi-cor grandes → muitos ficarão `family_diff`
  (reportado, não vinculado). É limitação do modelo agrupado, não bug.
- Marcação "sem produto" no ML pendente de endpoint confirmado.
