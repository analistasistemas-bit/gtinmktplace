# ADR-0025: Modelo de dados multicanal (`anuncios_externos` — listing por canal)

**Status:** Aceito (detalhado no início do épico E2, 2026-06-14)
**Data:** 2026-06-13 (direção) · 2026-06-14 (detalhamento E2)
**Decisores:** Diego
**Relaciona:** [evolução SaaS multicanal](../superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md) (E2); [spec do E2](../superpowers/specs/2026-06-14-e2-modelo-dados-multicanal-design.md); refina ADR-0007 (modelo de dados); incorpora o estado de catálogo do ADR-0021

## Contexto

Hoje o estado de publicação vive **dentro** de `familias`/`variacoes`: `ml_item_id`, `ml_permalink`,
`ml_variation_id`, `ml_picture_id`, `capa_ml_picture_id`, `categoria_ml_id`, `atributos_ml`, `catalog_*`.
Isso assume **1 família = 1 anúncio (ML)**. Com N canais, 1 família → N anúncios, e replicar colunas por
canal (`shopee_item_id`, `amazon_*`, …) trava a evolução. Todos os hubs pesquisados separam **catálogo
canônico** de **listing por canal**.

**Nuance descoberta no detalhamento (corrige o stub):** `familias` é **por-lote** (cada upload cria
linhas novas) e, após ciclos de UPDATE, **várias linhas de `familias` compartilham o mesmo `ml_item_id`**
(o `queries.ts` já deduplica por `ml_item_id` na tela Publicados). Logo `familia_id` **não é uma âncora
estável** para o anúncio. A identidade lógica estável do produto/anúncio é **`(user_id, codigo_pai)`**.

## Decisão

- **Âncora `(user_id, canal, codigo_pai)`** — não `familia_id`. `anuncios_externos` é a 1ª peça do futuro
  PIM (produto canônico estável), sem FK para `familias`.
- Nova tabela **`anuncios_externos`** (1 produto-canal por linha):
  `(id, user_id, canal, codigo_pai, item_externo_id, permalink, status, erro_mensagem,
  variacoes_externas JSONB, metadados_canal JSONB, preco_override numeric, publicado_em, atualizado_em)`,
  unique `(user_id, canal, codigo_pai)`. RLS por `user_id`.
- **`variacoes_externas` JSONB** = mapa `codigo (sku) → { variation_id, catalog_product_id,
  catalog_listing_id, catalog_status }`. Resolve a questão do `catalog_*`: o estado de catálogo (ADR-0021)
  é por-variação e por-canal → mora **dentro** do mapa, não em tabela própria.
- **Estratégia strangler — dual-write, leitura intacta:** os workers **continuam** gravando os `ml_*`/
  `catalog_*` em `familias`/`variacoes` (frontend e idempotência inalterados → zero risco) **e espelham**
  identidade+estado em `anuncios_externos`. `anuncios_externos` nasce e se mantém correto, pronto para o 2º
  canal e para um cutover de leitura futuro, sem mexer no que já fatura.
- **Backfill** na própria migration: `INSERT … SELECT DISTINCT ON (user_id, codigo_pai)` pela `familias`
  mais recente com `ml_item_id`, agregando as `variacoes` (`jsonb_object_agg`) num mapa `variacoes_externas`.
- Migração **aditiva** e reversível.

## Questões em aberto — resolvidas

- **Estoque por canal:** fica **na `variacoes` (estoque único)**, como hoje. Modelar por-listing agora é
  YAGNI (nenhum 2º canal exercita); quando a Shopee entrar (E5/E6) vira coluna aditiva em
  `anuncios_externos` — barato, pois a tabela já existirá. (Decisão Diego, 2026-06-14.)
- **`catalog_*`:** migra para o mapa `variacoes_externas` (por-variação, por-canal), não tabela própria.
- **`canais_conectados`:** **fora do E2.** `ml_credentials` já funciona (OAuth+Vault+lock Redis) e
  `canais_conectados` se entrelaça com `org_id`/tenancy → vai para o **E7**. (Decisão Diego, 2026-06-14.)
- **Idempotência por `(produto, canal)`:** o cutover da idempotência (ler `item_externo_id` de
  `anuncios_externos` em vez de `familias.ml_item_id`) é **diferido para o E2.5** junto com o drop das
  colunas `ml_*` e a view de compatibilidade. No E2 a idempotência segue lendo `familias.ml_item_id`.

## Escopo do E2 (e o que é diferido)

**No E2:** tabela `anuncios_externos` + enum `canal_externo` + RLS + backfill + helper `montarAnuncioExterno`
(puro, TDD) + dual-write nos workers (`publish-familia-ml`, `update-familia-ml`, `vincular-catalogo`).

**Diferido (E2.5 / "corte do tronco", quando o frontend migrar):** view de compatibilidade reexpondo
`ml_*`; cutover de leitura para `anuncios_externos`; remoção das colunas `ml_*`/`catalog_*` de
`familias`/`variacoes`.

## Consequências

- Catálogo agnóstico; 2º canal não exige reescrever o domínio. A estrutura 1:N existe e se mantém via
  dual-write, sem regressão no caminho que fatura.
- Custo: os workers passam a fazer 1 upsert extra (best-effort) por publicação/atualização — desprezível.
- Backfill obrigatório e delicado (verificar contagem de anúncios distintos antes/depois).
- Dívida explícita: enquanto o E2.5 não roda, o dado de publicação existe em dois lugares (colunas `ml_*` =
  fonte de verdade; `anuncios_externos` = espelho). O dual-write mantém os dois em sincronia.
