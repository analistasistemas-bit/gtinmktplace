# Spike 057 — aba Campanhas do /ads: o que a API entrega "agora"

**Data:** 2026-10-20 · **Relacionado:** emenda de 2026-10-20 ao [ADR-0179](../decisions/0179-painel-de-ads.md),
[spike 053](053-product-ads-ml.md), [ADR-0177](../decisions/0177-multiget-ml-items-bulk.md) (`/items/bulk`)
**Método:** API real, só GET, tokens lidos via `get_connection_tokens` (Management API, SQL read-only), nunca
renovados nem impressos. Hairfly (1 campanha, criada hoje) e Avil (7 campanhas). Script:
`python3 scripts/spike-ads-campanhas.py <connection_id> <saida_dir>`. Total: 7 + 9 + 3 chamadas.

## Respostas

1. **Busca no nível do anunciante existe.** `GET /marketplace/advertising/MLB/advertisers/{adv}/product_ads/ads/search`
   (`api-version: 2`) → 200, ~400 ms, paginado (`limit=50`). Aceita `filters[campaign_id]=` (Avil, Curva A:
   total 5). Sem filtro a Avil devolve **595** anúncios, a maioria `idle` de uma campanha que não está em
   `active,paused` (id 357912053, provável excluída) → **ler por campanha ativa/pausada**, não a busca crua.
   Não é preciso uma chamada por grupo. `items/search` → 404.
2. **Campos do anúncio:** `item_id, campaign_id, ad_group_id, status, status_raw, catalog_listing, family_id,
   user_product_id, price, title, thumbnail, permalink, logistic_type, listing_type_id, domain_id, current_level,
   buy_box_winner, deferred_stock, recommended, has_discount, image_quality`; `metrics=` opcional.
3. **Campos da campanha** (`campaigns/search` e `campaigns/{id}`): `name, status, strategy` (todas
   `PROFITABILITY` nas duas orgs), `roas_target`, `acos_target` (= 100 ÷ ROAS: 5x → 20), `daily_budget`,
   `automatic_budget`, `date_created`, `last_updated`. **O tipo** (automática/personalizada) **e o diagnóstico**
   ("Aprendendo") **não vêm** em nenhum campo.
4. **"5 anúncios patrocinados" do ML = 5 grupos** (`ad_group_id` distintos). A Hairfly tem 8 MLBs: 5 `active` e
   3 `hold`.
5. **`hold` não é um estado só.** Medido via `/items/{id}`:

   | Caso | `status_raw` | Item no ML | Leitura |
   |---|---|---|---|
   | Hairfly ×3 | `Y` | anúncio comum (`catalog_listing=false`) com o irmão de catálogo do mesmo grupo `active` | normal, não é alerta |
   | Avil, Curva A | `S` | `paused`, `out_of_stock`, estoque 0 | patrocinado parado |
   | Avil | `G` | `paused`, `out_of_stock` (catálogo) | patrocinado parado |
   | Avil, campanha fora da lista | `C` | `active`, estoque 100 | indefinido |

## Consequências para o design

- Leitura sob demanda viável: 1 `campaigns/search` + 1 paginação de `ads/search` por campanha ativa/pausada
  (Avil: 4 ativas + 3 pausadas, poucas páginas). Cache curto por org continua necessário.
- **Alerta "patrocinado parado"** usa o status do **item** (`/items/bulk`: `paused`/`out_of_stock`/inativo), nunca o
  `status_raw` do Ads. `hold` com irmão `active` no mesmo grupo não alerta.
- **Diagnóstico e tipo da campanha:** fora da tela (não estão na API); mostrar nome, estado, estratégia, orçamento
  diário e ROAS objetivo.
- **ROAS objetivo × margem:** comparar `acos_target` direto com o ACOS de equilíbrio pelo preço.
