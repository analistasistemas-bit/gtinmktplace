# E5 — Conector Shopee (design)

**Data:** 2026-06-15
**Épico:** E5 (Fase 2 da Evolução SaaS — 2º canal)
**Antecede:** ADR-0029 (decisão Shopee) → plano → execução subagent-driven
**Fundação reusada:** ADR-0024 (abstração de canais), ADR-0025 (dados multicanal `anuncios_externos`), ADR-0012 (refresh OAuth com lock Redis), ADR-0011 (redirect via edge function)

> Revisado após review crítico (2026-06-15): worker dedicado em vez de "generalizar por parâmetro", neutralização de tipos ML em `contrato.ts`, estado Shopee em `anuncios_externos`, e lacunas de API endereçadas.

## Objetivo

Implementar um `shopeeConnector` que satisfaz a interface `ChannelConnector`, permitindo publicar/atualizar/ler anúncios na Shopee Brasil a partir do mesmo modelo canônico que hoje alimenta o ML. O E5 entrega **o conector + o caminho de publicação Shopee**; a UI de seleção de canal e a publicação multicanal simultânea são o **E6**.

## Princípio e o que o review corrigiu

A intenção é "preencher um conector", mas o review mostrou que isso **não** é literalmente verdade hoje:

- `publish-familia-ml/index.ts` tem 12+ pontos acoplados a colunas `ml_*` (`ml_item_id`, `ml_picture_id`, `capa_ml_picture_id`, `titulo_ml`, `descricao_ml`, `categoria_ml_id`, `atributos_ml`, `ml_variation_id`, `ml_permalink`, opt-in de catálogo). Não dá para "ligar um `if canal`".
- `contrato.ts` importa tipos ML-específicos (`AtributoItem` de `ml/publicar.ts`, `DimensoesPacote` de `ml/pacote.ts`) e expõe `listingTypeId` — o contrato "canônico" vaza ML.
- `espelhar.ts` fixa `canal: 'mercado_livre'`.

Logo, o E5 tem uma **Fatia 0 preparatória** (neutralizar o que vaza) + **worker dedicado** Shopee.

## Estratégia de fatias

| Fatia | Escopo | Bloqueio externo |
|---|---|---|
| **0 (prep)** | Neutralizar leakage de tipos em `contrato.ts`; parametrizar `espelhar` por `CanalId`. Zero mudança de comportamento, testes ML continuam verdes. | nenhum |
| **1** | Auth (OAuth loja + HMAC + refresh) · `publish-familia-shopee` cria 1 anúncio simples (1 variação, foto/preço/estoque, **categoria manual**) · `lerStatus` · estado em `anuncios_externos` | Test App (sandbox); Live App (publish real) |
| **2** | Variações múltiplas (`tier_variation`/`model`) · múltiplas fotos | idem |
| **3** | `atualizarAnuncio` (repor estoque/preço, cores novas) | idem |
| **4** (adiada) | Categoria/atributos por IA (taxonomia Shopee) | — |

## Fatia 0 — Preparatória (neutralizar leakage)

- Mover as definições de `AtributoItem` e `DimensoesPacote` para `_shared/canais/tipos.ts` (canal-neutro); `ml/publicar.ts` e `ml/pacote.ts` passam a **re-exportar** desses tipos (back-compat, zero mudança de runtime).
- `listingTypeId?` permanece opcional no `AnuncioCanonico` e é tratado como **ML-only** (a Shopee ignora). Documentado como capability-gated.
- `espelhar.ts`: generalizar `montarAnuncioExterno`/`espelharAnuncioExterno` para receber `canal: CanalId` e um mapa de variações canal-neutro (`sku → { variation_id, ...metadados }`), preservando o comportamento ML atual (o ML continua passando `mercado_livre`). Os testes de `espelhar` existentes devem continuar passando.
- Critério de saída: `npm test`, `tsc` e `eslint` verdes, sem mudança observável no caminho ML.

## Arquitetura (Fatia 1)

```
_shared/canais/
  contrato.ts          ← + 'shopee' em CanalId; ContextoCanal ganha shopId? (canal shop-scoped)
  registry.ts          ← + 'shopee'
  tipos.ts             ← (Fatia 0) AtributoItem, DimensoesPacote canal-neutros
  shopee.ts            ← shopeeConnector: ChannelConnector
_shared/shopee/
  assinatura.ts        ← base string + HMAC-SHA256 (public/shop)  [implementado]
  token.ts             ← OAuth (code→token), refresh (lock Redis), getValidAccessToken
  cliente.ts           ← shopeeGet/shopeePost (assina, injeta common params, trata erro HTTP-200-com-erro)
  item.ts              ← montar payload add_item a partir de AnuncioCanonico
  categoria.ts         ← get_category / get_attribute_tree (consulta; seleção é manual na Fatia 1)
  fotos.ts             ← upload_image (MediaSpace, multipart) → image_id
  status.ts            ← parse item_status → StatusCanal
  mapeamento.ts        ← erro Shopee → ErroCanalCodigo
supabase/functions/
  shopee-oauth-start/  ← monta auth_partner URL e redireciona
  shopee-oauth-callback/← troca code por token, persiste credencial (Vault)
  publish-familia-shopee/← worker dedicado (espelha publish-familia-ml, estado em anuncios_externos)
```

## Onde mora o estado Shopee (resolve o crítico #1)

**Não** adicionamos colunas `shopee_*` em `familias`/`variacoes`. O estado de publicação Shopee vive em `anuncios_externos` (já multicanal, ADR-0025):

- `item_externo_id` = item_id Shopee; `permalink`; `status`; `variacoes_externas` = `sku → { variation_id: model_id }`.
- `metadados_canal` (jsonb já existente) guarda **cache de idempotência de retry**: `{ shop_id, fotos: { capa: image_id, capa2:..., <sku>: image_id } }`.
- `familias.status` continua genérico (`publicando`/`publicado`/`erro`); a fonte de verdade do anúncio Shopee é a row de `anuncios_externos`.

Fluxo do `publish-familia-shopee`:
1. Upsert da row `anuncios_externos` (canal `shopee`, status `publicando`) cedo, para ancorar o cache de `fotos`.
2. Sobe fotos faltantes (consulta `metadados_canal.fotos` antes; idempotente no retry).
3. `criarAnuncio` (add_item). Sucesso → grava `item_externo_id`, `variacoes_externas`, `status='publicado'`.
4. Erro: classifica (retentável → QStash retenta; definitivo → `status='erro'` + `erro_mensagem`). Reusa `_shared/publicacao/retry.ts`.

## Autenticação (Fatia 1)

### Assinatura HMAC-SHA256  [implementado em `assinatura.ts`]
Base string por tipo de API, assinada com `partner_key`:
- **Public:** `partner_id + path + timestamp`
- **Shop:** `partner_id + path + timestamp + access_token + shop_id`

`timestamp` em janela de 5 min; `sign` hex anexado aos common params na query.

### OAuth da loja (ADR-0011)
1. `shopee-oauth-start`: `GET {host}/api/v2/shop/auth_partner?partner_id&timestamp&sign&redirect={callback}` → redireciona o operador.
2. Callback `?code=...&shop_id=...` (válido 5 min).
3. `shopee-oauth-callback`: `POST /api/v2/auth/token/get` (public) com `{code, shop_id, partner_id}` → `access_token` (4h) + `refresh_token` (~1 mês). Persiste credencial (Vault).

### Refresh (ADR-0012)
`getValidAccessToken(userId)`: se expirar no buffer, `POST /api/v2/auth/access_token/get` com `refresh_token` sob lock Redis (`lock:shopee:refresh:{userId}`), persiste o **novo** `refresh_token` retornado. *A verificar contra sandbox: se o refresh antigo é invalidado imediatamente (rotacional) — o lock protege contra corrida de qualquer forma.*

### Credenciais (migration)
Tabela `shopee_credentials` (user_id, shop_id, access_token, refresh_token, expires_at, scope) com RLS por `user_id`; tokens via Vault (RPCs `get_shopee_tokens` / `upsert_shopee_credentials`, espelhando `ml_credentials`). `partner_id/partner_key/host/redirect` por env→Vault (`SHOPEE_*`).

### Roteamento de token por canal
O `publish-familia-shopee` constrói o `ContextoCanal` do canal Shopee: `getToken()` → `getValidAccessToken` do `_shared/shopee/token.ts`, e `shopId` resolvido da credencial. `ContextoCanal` ganha `shopId?: string` (canais shop-scoped); o ML ignora.

## Modelo de item (Fatia 1: 1 variação)

`montarPayloadItem(AnuncioCanonico)` → corpo de `POST /api/v2/product/add_item`:
- `category_id` (manual), `item_name` (titulo), `description` (a descrição vai **dentro** do add_item — `descricaoSeparada:false`), `original_price`, `seller_stock`/stock, `weight` (**conversão `peso_gramas`→kg**, dividir por 1000 — *unidade a confirmar contra sandbox BR*), `dimension` (length/width/height), `image: { image_id_list }`, `logistic_info` (canais de `get_channel_list` habilitados), `item_sku` = nosso `codigo`, `brand` quando a categoria exigir.
- `capabilities` Shopee: `{ variacoes:true, descricaoSeparada:false, catalogo:false, desconto:true, dimensoesPacote:true }`.
- `garantirDescricao`/`sincronizarDescricao` são **no-ops explícitos** no `shopeeConnector` (descrição já embutida no add_item) — métodos obrigatórios da interface, implementados como `async () => {}` / `async () => null`, com comentário.

### Variações (Fatia 2)
Shopee: `tier_variation` (eixo "Cor") + `model` (combinações preço/estoque/`model_sku`), via `add_item` + `init_tier_variation`/`add_model`. Adapter mapeia `VariacaoCanonica[]` → 1 eixo + N models. Documentado; implementado na Fatia 2.

## Fotos (MediaSpace)
`subirFoto(ctx, sourceUrl)`: baixa a URL assinada do nosso Storage e faz `POST /api/v2/media_space/upload_image` (**multipart/form-data binário**, limite ~2 MB/imagem — *confirmar limite/dimensões contra a doc*) → `image_id`. Cache do `image_id` em `anuncios_externos.metadados_canal.fotos` para idempotência de retry.

## Status
`lerStatus(itemIds)`: `GET /api/v2/product/get_item_base_info?item_id_list=...` → mapeia `item_status` (NORMAL/BANNED/DELETED/UNLIST/REVIEWING) para `StatusAnuncioCanal`.

## Tratamento de erro
A Shopee retorna `{ error, message, request_id }` com **HTTP 200 mesmo em erro de negócio**. `classificarErroShopee` mapeia `error` (`error_auth`/`error_permission`/`error_param`/rate limit/`error_server`) → `ErroCanalCodigo` (`AUTENTICACAO`/`ATRIBUTO`/`CATEGORIA`/`FOTO`/`RATE_LIMIT`/`INDISPONIVEL`/`DESCONHECIDO`) + `retentavel` (auth-expirado/rate/5xx). O worker reusa `_shared/publicacao/retry.ts`.

### Rate limits / throttling
A Shopee impõe limites por API (a confirmar os números exatos contra a doc). Reaproveitar o pool de concorrência (`_shared/concorrencia/pool.ts`) e classificar `RATE_LIMIT` como retentável (backoff via QStash).

## Migrations (aditivas, seguras)
1. `ALTER TYPE canal_externo ADD VALUE IF NOT EXISTS 'shopee';`
2. `create table shopee_credentials (...)` + RLS por user_id + RPCs Vault.
Ambas aditivas — não tocam dados/colunas existentes; o caminho ML é inalterado.

## Testes
- **Unidade (sem conta):** assinatura [feito], montagem `add_item`, parse de status, classificação de erro, decisão de refresh, conversão de peso. Espelha `_shared/ml/__tests__/`.
- **Integração (Test App):** smoke de auth+sign contra sandbox.
- **E2E (Live App + loja):** publicar item real, ler status, cleanup.

## Rollback
Tudo na branch isolada `worktree-e5-conector-shopee`, **não mergeado** até validar. As migrations são aditivas (enum value + tabela nova). Em produção, o caminho Shopee fica **dormente** (nada enfileira `publish-familia-shopee` nem usa canal `shopee`) até o E6/ativação. Reverter = não rotear nada para Shopee.

## Não-objetivos (E5)
- Orquestração multicanal simultânea + UI de seleção de canal → E6.
- Categoria/atributos por IA na taxonomia Shopee → Fatia 4.
- Pedidos, envio, financeiro.

## Riscos
- **Lead time de aprovação do Live App** (gating do publish real).
- **Logística obrigatória no item:** add_item pode falhar sem canal de envio ativo na loja — validar `get_channel_list` na Fatia 1.
- **Unidades/campos BR do add_item** (peso kg vs g, campos obrigatórios por categoria) — confirmar contra sandbox.
- **Rotação do refresh_token** — confirmar comportamento; lock Redis mitiga corrida.

## Estado da implementação (2026-06-15) — branch `worktree-e5-conector-shopee`

**Código-completo e testado por unidade (700+ testes, tsc/eslint verdes), na branch, NÃO mergeado/deployado:**
- Fatia 0: tipos neutralizados (`_shared/canais/tipos.ts`), `CanalId += 'shopee'`, `ContextoCanal.shopId?`.
- `_shared/shopee/`: assinatura, status, mapeamento, item (peso g→kg, item_sku, descrição embutida), cliente, token (OAuth/refresh), fotos, categoria.
- `_shared/canais/shopee.ts`: `shopeeConnector` (no-ops de descrição, `atualizar=NAO_SUPORTADO` Fatia 1, `lerStatus` em lote) + `registry`.
- Edge functions: `shopee-oauth-start`, `shopee-oauth-callback`, `publish-familia-shopee` (estado em `anuncios_externos`, cache de foto p/ idempotência).
- Migration `e5_shopee_credentials` (enum + tabela + RPCs Vault) — **não aplicada**.

**Lacunas conhecidas (Fatia 1):**
- **Enfileiramento Shopee não wired:** `queue.ts` ainda só enfileira o worker ML; disparar `publish-familia-shopee` (e a UI de seleção de canal) é E6. Para teste de sandbox, o worker pode ser invocado diretamente.
- **Categoria Shopee** vem de `metadados_canal.categoria_id` (operador define manualmente); UI para isso é E6.

**Bloqueio para prosseguir (precisa do Diego):** integração real (auth/sign contra sandbox; publish real) exige a conta Shopee Open Platform — ver `docs/shopee-open-platform-setup.md`. Sem o Test App (`partner_id/partner_key`) não há como validar assinatura/host nem publicar. Este é o ponto onde a implementação para sem intervenção externa.
