# ADR-0029: Conector Shopee (2º canal sobre a abstração ChannelConnector)

**Status:** Aceito
**Data:** 2026-06-15
**Decisores:** Diego
**Relaciona:** [E5 — conector Shopee (design)](../superpowers/specs/2026-06-15-e5-conector-shopee-design.md); concretiza ADR-0024 (abstração de canais) e ADR-0025 (dados multicanal); reusa ADR-0011 (redirect via edge function) e ADR-0012 (refresh OAuth com lock Redis)

## Contexto

A fundação multicanal (E1/E2) está em produção: `ChannelConnector` + `registry` + `anuncios_externos` agnóstico de canal, com o ML como 1º conector. O E5 adiciona a Shopee Brasil como 2º canal. A Shopee Open Platform difere do ML em pontos estruturais: assinatura HMAC-SHA256 por request, OAuth por loja (`shop_id`) com token de 4h e refresh de ~1 mês, modelo de variação `tier_variation`/`model`, descrição embutida no item, logística obrigatória no item e taxonomia/atributos próprios.

## Decisão

1. **Fatia 0 preparatória (zero mudança de comportamento):** mover `AtributoItem`/`DimensoesPacote` de `ml/*` para `_shared/canais/tipos.ts` (re-export em `ml/*` por back-compat); tratar `listingTypeId?` como ML-only; parametrizar `espelharAnuncioExterno` por `CanalId`. Resolve o vazamento ML em `contrato.ts`/`espelhar.ts` apontado no review. Testes ML continuam verdes.
2. **Implementar `shopeeConnector: ChannelConnector`** em `_shared/canais/shopee.ts`, registrado como `shopee`. Submódulos em `_shared/shopee/` (espelham `_shared/ml/`): `assinatura`, `token`, `cliente`, `item`, `categoria`, `fotos`, `status`, `mapeamento`. Funções puras testáveis; HTTP mockado.
3. **Worker dedicado `publish-familia-shopee`** (não "generalizar `publish-familia-ml` por parâmetro" — o review mostrou 12+ acoplamentos a colunas `ml_*`). O **estado de publicação Shopee mora em `anuncios_externos`** (multicanal por ADR-0025): `item_externo_id`, `variacoes_externas` (`sku→model_id`), e `metadados_canal` jsonb para cache de `image_id`/`shop_id` (idempotência de retry). Sem colunas `shopee_*` em `familias`.
4. **Auth:** HMAC por tipo de API (public/shop); OAuth `shopee-oauth-start`/`shopee-oauth-callback` (ADR-0011); refresh com lock Redis (ADR-0012). Credenciais em `shopee_credentials` (Vault, RLS). `ContextoCanal` ganha `shopId?` para canais shop-scoped.
5. **`capabilities` Shopee:** `descricaoSeparada:false` (descrição embutida no add_item → `garantirDescricao`/`sincronizarDescricao` são no-ops explícitos), `catalogo:false`, `variacoes/desconto/dimensoesPacote:true`.
6. **Categoria manual na 1ª fatia:** operador escolhe na Revisão; IA de taxonomia Shopee adiada (Fatia 4/E6).
7. **Entrega em fatias:** 0 (prep) → 1 (auth + criar 1 anúncio + status) → 2 (variações) → 3 (update) → 4 (IA).
8. **Erro unificado:** `classificarErroShopee` mapeia `error` (HTTP 200 com erro de negócio) → `ErroCanalCodigo` + `retentavel`, reusando `_shared/publicacao/retry.ts`. **Migrations aditivas:** `ALTER TYPE canal_externo ADD VALUE 'shopee'` + tabela `shopee_credentials`.

## Alternativas consideradas

- **Conector completo contra mocks + 1 integração no fim:** risco de big-bang na integração (lição do E4) — rejeitada.
- **Espelhar o ML 1:1:** maior e mais arriscado; inclui recursos que a Shopee não tem (buybox/catálogo) — rejeitada.
- **Categoria por IA desde já:** é a "taxonomia canônica" que o ADR-0026 adiou de propósito para o 2º canal — adiada.

## Consequências

- 2º canal sem tocar o caminho ML; ganho incremental e testável por fatia.
- Pendências externas (gating): Test App (sandbox) e Live App + loja autorizada (publish real) — trilho em `docs/shopee-open-platform-setup.md`.
- Risco: logística obrigatória no item pode bloquear o `add_item` até a loja ter canal de envio ativo; mitigado validando `get_channel_list` no design da Fatia 1.

## Questões em aberto (confirmar contra sandbox quando a conta existir)

- Forma exata do payload `add_item` para BR (campos obrigatórios por categoria; unidade de `weight` — kg vs g).
- Mapeamento fino de `item_status` Shopee → `StatusAnuncioCanal`.
- Comportamento de rotação/invalidação do `refresh_token` (o lock Redis mitiga corrida de qualquer forma).
- Limites de rate exatos por API e estratégia de backoff.
- Logística obrigatória no item (`get_channel_list`) — pode bloquear `add_item` até a loja ter canal de envio ativo.
