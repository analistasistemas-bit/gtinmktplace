# ADR-0025: Modelo de dados multicanal (`anuncios_externos` — listing por canal)

**Status:** Proposto (stub — detalhar no início do épico E2)
**Data:** 2026-06-13
**Decisores:** Diego
**Relaciona:** [evolução SaaS multicanal](../superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md) (E2); refina ADR-0007 (modelo de dados)

## Contexto

Hoje o estado de publicação vive **dentro** de `familias`/`variacoes`: `ml_item_id`, `ml_permalink`,
`ml_variation_id`, `ml_picture_id`, `capa_ml_picture_id`, `categoria_ml_id`, `atributos_ml`, `catalog_*`.
Isso assume **1 família = 1 anúncio (ML)**. Com N canais, 1 família → N anúncios, e replicar colunas por
canal (`shopee_item_id`, `amazon_*`, …) trava a evolução. Todos os hubs pesquisados separam **catálogo
canônico** de **listing por canal**.

## Decisão (direção)

- Nova tabela `anuncios_externos` (1:N por família): `(id, familia_id, canal, item_externo_id,
  variacao_externa_id JSONB sku→id, permalink, status, atributos_canal JSONB, preco_override, erro,
  atualizado_em)`, unique `(familia_id, canal)`.
- Nova tabela `canais_conectados` (org/user, canal, status).
- Backfill: copiar os `ml_*` atuais para `anuncios_externos` (canal=`mercado_livre`).
- View de compatibilidade reexpõe `ml_*` durante a transição (strangler do schema; evita big-bang no
  frontend). Remover as colunas `ml_*` só quando o frontend migrar.
- Migração **aditiva** e reversível por passo.

## Questões em aberto

- Onde mora o estoque por canal (modelar cedo p/ evitar oversell, mesmo se MVP usa estoque único).
- `catalog_*` (opt-in ML, ADR-0021): migrar para `atributos_canal` ou tabela própria.
- Idempotência por `(familia, canal)` em vez de `ml_item_id` global.

## Consequências

- Catálogo agnóstico; 2º canal não exige reescrever o domínio. Migração + backfill obrigatórios e
  delicados (verificar contagens antes/depois).
