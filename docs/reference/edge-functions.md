# Referência — Edge Functions

> **Tipo:** Reference (Diátaxis). As 32 Edge Functions Deno do PubliAI (`supabase/functions/`).
> `verify_jwt` é extraído de `supabase/config.toml` (verdade de configuração). Trigger e
> idempotência vêm do código de cada `index.ts`. Termos em [glossario.md](glossario.md);
> deploy em [../how-to/deploy-e-migrations.md](../how-to/deploy-e-migrations.md).

## Como ler o `verify_jwt`

- **`true`** → o gateway do Supabase exige um JWT Supabase válido **antes** de executar a
  função. Usado por chamadas do frontend (token do usuário logado).
- **`false`** → função pública; ela mesma autentica: assinatura QStash
  (`verificarAssinatura`), JWT lido na mão (`requireUser`), ou endpoint público (OAuth/webhook).
- Funções **não listadas** no `config.toml` assumem o **default `true`** (caso de `resumo-financeiro`).

> ⚠️ Há divergências atuais entre `verify_jwt` e o modo de acionamento de algumas funções
> de QStash/webhook — ver [Inconsistências conhecidas](#inconsistências-conhecidas-de-verify_jwt).

## Tabela-resumo

| Função | verify_jwt | Trigger | Idempotente |
|---|---|---|---|
| **OAuth / conexão ML** ||||
| ml-oauth-start | false | HTTP (JWT manual) | não |
| ml-oauth-callback | false | Redirect OAuth do ML | não |
| ml-oauth-disconnect | false | HTTP (JWT manual) | sim |
| **Ingest de planilha** ||||
| ingest-lote | true | HTTP (frontend) | não |
| upload-imagens-lote | true | HTTP (frontend, FormData) | não |
| **Processamento / publicação** ||||
| process-familia | false | QStash worker | sim (claim atômico) |
| publicar-familias | true | HTTP (frontend) | não |
| publish-familia-ml | false | QStash (fila serial) | sim (reusa picture_ids) |
| update-familia-ml | false | QStash (fila serial) | sim |
| publicar-split-ml | false | QStash (fila serial) | sim (item cravado cedo) |
| regenerar-copy-familia | false | HTTP (JWT manual) | não |
| definir-categoria-familia | true | HTTP (frontend) | não |
| vincular-catalogo | false | QStash (delay 10min) | sim (upsert) |
| **Remoção / reprocessamento** ||||
| remover-publicado | false | HTTP (JWT manual) | sim (guarded) |
| excluir-lote | true | HTTP (frontend) | não |
| reprocessar-familia | false | HTTP (JWT manual) | sim (guard de status) |
| invalidar-cache-cor | true | HTTP (frontend) | não |
| **Faturamento (vendas/perguntas/devoluções)** ||||
| ml-webhook | true ⚠️ | Webhook do ML | sim (dedup) |
| sync-venda | true ⚠️ | QStash worker | sim (upsert) |
| sync-pergunta | false | QStash worker | sim (upsert) |
| sync-devolucao | false | QStash worker | sim (upsert) |
| responder-pergunta | true | HTTP (frontend) | não |
| sugerir-resposta-pergunta | true | HTTP (frontend) | não (stateless) |
| backfill-faturamento | true ⚠️ | HTTP (JWT) **ou** QStash | sim (upsert) |
| reconciliar-faturamento | true ⚠️ | QStash schedule | sim (upsert) |
| **Financeiro (Mercado Pago)** ||||
| resumo-financeiro | true (default) | HTTP (frontend) | não |
| **Monitoramento / alertas** ||||
| monitorar-moderados | false | HTTP (JWT manual) ou QStash | sim |
| notificar-liberacao | false | QStash schedule | sim (1×/dia BRT) |
| **Status / métricas / viabilidade** ||||
| status-publicados | true | HTTP (frontend) | sim (leitura) |
| metricas-vendas | true | HTTP (frontend) | sim (leitura) |
| analisar-viabilidade | true | HTTP (frontend) | não |
| calcular-tarifa-ml | false | HTTP (JWT manual) | sim (cache 6h) |
| **Acesso / usuários** ||||
| usuarios | true | HTTP (frontend, admin) | sim (upsert/idempotente) |
| **Utilitário** ||||
| hello | false | HTTP (smoke test) | sim |

---

## Módulos compartilhados (`_shared/`)

| Módulo | Provê |
|---|---|
| `auth.ts` | `requireUser(req)` — valida Bearer token contra o Supabase Auth |
| `cors.ts` | Headers CORS padrão (inclui `upstash-signature`) |
| `supabase.ts` | `adminClient()` (service_role) e `userClient(jwt)` (respeita RLS) |
| `queue.ts` | QStash: `enfileirarFamilia/Publicacao/Atualizacao/VinculacaoCatalogo`, `garantirFilaSerial`, `verificarAssinatura` |
| `ml/*` | Integração ML: token/OAuth, criar/atualizar item, descrição, concorrência, catálogo, tarifa, atacado |
| `ai/*` | OpenRouter: copywriter, vision (cor), título, resposta a pergunta, categoria/atributos por LLM |
| `canais/*` | Conector multicanal: `getConnector(canal)` + contrato + `MercadoLivreConnector` |
| `redis/*` | Client Redis + caches (cor, concorrência, tarifa) |
| `faturamento/*` | I/O de vendas/perguntas/devoluções + enriquecimento (líquido, EAN) |
| `mercadopago/*` | API MP (pagamentos) + rateio financeiro |
| `categoria/*`, `cor/*`, `preco/*` | Detecção de categoria, extração de cor, lógica de preço/desconto |
| `notificacoes/*` | Telegram (vendas, perguntas, devoluções, liberações, moderados, catálogo) |
| `parser.ts` | Validação de colunas da planilha, agrupamento por PAI, matching de fotos |

---

## Por domínio

### OAuth / conexão ML
- **ml-oauth-start** — gera `state` (UUID, TTL 10min no Redis) e monta a URL de autorização.
  Secrets: `ML_CLIENT_ID`, `ML_REDIRECT_URI`.
- **ml-oauth-callback** — troca `code` por access/refresh token e grava via
  `upsert_ml_credentials` (Vault). Endpoint público (redirect do ML).
- **ml-oauth-disconnect** — remove credenciais (`delete_ml_credentials`).

### Ingest de planilha
- **ingest-lote** — valida colunas, agrupa variações por PAI, casa fotos, detecta CREATE vs
  UPDATE, cria `familias`+`variacoes` e enfileira as pendentes (`enfileirarFamilia`). Edge
  cases em ADR-0013.
- **upload-imagens-lote** — recebe FormData de imagens e casa por nome de arquivo
  (`00CODIGO`, `CAPA_…`, `CAPA2_…`, `CAPA3_…`) com variações/família.

### Processamento / publicação
- **process-familia** *(worker)* — claim atômico `pendente→processando`, resolve cor
  (dicionário → Vision → cache Redis), gera copy (OpenRouter), detecta categoria, monta
  atributos, calcula estratégia de preço e análise de mercado; marca `pronto`/`erro`.
- **publicar-familias** — marca famílias `publicando`, garante a fila serial
  (`parallelism=1`) e enfileira os jobs de publicação (ADR-0034).
- **publish-familia-ml** *(worker, CREATE)* — sobe fotos, cria o item no ML, aplica atacado
  (PxQ), espelha em `anuncios_externos` e enfileira o vínculo de catálogo com delay. Reusa
  `picture_id` em retry (idempotência). Retry de foto: ADR-0033.
- **update-familia-ml** *(worker, UPDATE)* — repõe estoque em cores casadas, cria variação
  para cor nova, sincroniza marca/dimensões, atualiza descrição só se mudou; atacado e catálogo.
- **publicar-split-ml** *(worker, split — ADR-0048)* — produto com >100 cores publica em N anúncios
  ("partições"). `publicar-familias` roteia >100 cores incluídas pra cá. Particiona alfabético com
  ancoragem (cor publicada não migra), título distinto por IA, cap de estoque (99.999) via conector.
  Grava o item da partição cedo (anti-duplicação em retry); partição 0 herda `ml_item_id` existente.
  Catálogo por-partição é follow-up (hoje cobre só a partição 0).
- **regenerar-copy-familia** — regera título/descrição via IA sem republicar.
- **definir-categoria-familia** — seletor manual de categoria (escape hatch p/ "outro"),
  monta atributos obrigatórios (ADR-0022).
- **vincular-catalogo** *(worker, delay 10min)* — opt-in de catálogo por GTIN; alerta Telegram
  em no-match/ficha divergente (ADR-0021/0036).

### Remoção / reprocessamento
- **remover-publicado** — remove todas as linhas publicadas de um mesmo `codigo_pai` (global
  por user+codigo_pai), limpa storage e `anuncios_externos`; bloqueia se há UPDATE em voo.
- **excluir-lote** — exclui o lote; preserva publicados (ADR-0019); bloqueia se processando/publicando.
- **reprocessar-familia** — reseta `erro→pendente` e re-enfileira (guard idempotente, ADR-0030).
- **invalidar-cache-cor** — limpa o cache Redis de cor de um código (após refazer a foto).

### Faturamento
- **ml-webhook** — receiver público do ML: ACK rápido (<500ms), dedup em `ml_webhook_eventos`,
  roteia para `sync-venda` (orders/shipments), `sync-pergunta` (questions) ou `sync-devolucao`
  (claims). Nunca confia no corpo — o worker re-busca autenticado (ADR-0037).
- **sync-venda / sync-pergunta / sync-devolucao** *(workers)* — buscam o recurso no ML e fazem
  upsert em `ml_vendas`/`ml_perguntas`/`ml_devolucoes`; alertam Telegram.
- **responder-pergunta** — envia resposta do operador ao ML (≤2000 chars) e atualiza o registro.
- **sugerir-resposta-pergunta** — IA sugere resposta (não envia ao ML).
- **backfill-faturamento** — sincroniza um período retroativo. Dois modos: usuário logado (JWT)
  ou todos os usuários (QStash). Não busca shipment (frete fica nulo).
- **reconciliar-faturamento** *(schedule)* — rede de segurança: re-sincroniza as últimas ~72h
  de todos os usuários com credencial (cobre webhooks perdidos).

### Financeiro (Mercado Pago)
- **resumo-financeiro** — agrega pagamentos do MP (bruto/líquido/descontos) e cruza com custo
  por código. Secret: `MP_ACCESS_TOKEN` (single-tenant hoje — ADR-0031).

### Monitoramento / alertas
- **monitorar-moderados** — varre publicados, detecta moderação nova/resolvida, alerta Telegram
  (ADR-0035). Runbook: [../runbooks/monitorar-moderados.md](../runbooks/monitorar-moderados.md).
- **notificar-liberacao** — alerta quando uma venda é liberada no saldo MP; idempotente por dia BRT (ADR-0040).

### Status / métricas / viabilidade
- **status-publicados** — lê status dos anúncios via conector multicanal (resiliente a "sem credencial").
- **metricas-vendas** — agrega vendas do período por anúncio gerenciado (mapa GTIN→item).
- **analisar-viabilidade** — concorrência + comissões + margem antes de cadastrar (ADR-0014/0015).
- **calcular-tarifa-ml** — comissões (classic + premium) por preço/categoria; cache Redis 6h.

### Acesso / usuários

- **usuarios** — gestão de usuários por **admin** (ADR-0047). `verify_jwt=true`; valida que o
  chamador é admin (`requireUser` + `profiles.is_admin`) e usa `service_role`. Ações: `invite`
  (`auth.admin.inviteUserByEmail` com `nome`/`allowed_menus` no metadata + `redirectTo` para
  `/#/definir-senha`), `update_menus`, `set_active`, `set_admin`. Requer o secret `APP_URL`.

### Utilitário
- **hello** — smoke test de deploy.

---

## Padrões transversais

- **Idempotência (regra inegociável):** claims atômicos (`UPDATE … WHERE status=…`), upserts,
  reuso de `picture_id`/IDs já gravados, guards de status. Workers podem ser reexecutados pelo
  retry do QStash sem duplicar efeito.
- **Fila serial de publicação:** `garantirFilaSerial(userId)` → `parallelism=1` por usuário (ADR-0034).
- **Dedup de webhook:** `(topic, resource)` único em `ml_webhook_eventos`.
- **Secrets principais:** `SUPABASE_*`, `QSTASH_TOKEN`/`QSTASH_*_SIGNING_KEY`, `ML_CLIENT_ID`/
  `ML_CLIENT_SECRET`/`ML_REDIRECT_URI`, `OPENROUTER_API_KEY` (+`AI_MODEL_*`),
  `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `MP_ACCESS_TOKEN`, `PUBLIAI_PUBLIC_URL`. Lista em `.env.example`.

---

## Inconsistências conhecidas de `verify_jwt` — INCIDENTE CONFIRMADO

> Divergência entre `config.toml` e o modo de acionamento, **confirmada em produção via logs
> do edge gateway** (24h, 2026-06-28). Mesma classe do incidente
> `reference_workers_qstash_verify_jwt` (deploy que travou lotes).

O enfileirador (`_shared/queue.ts`) publica no QStash **sem** header `Authorization`, e o ML
chama o webhook sem JWT Supabase. Funções com `verify_jwt=true` acionadas assim são
**rejeitadas pelo gateway (401) antes de executar** sua própria checagem de assinatura.

**Evidência (function_edge_logs, últimas 24h):**

| Função | `verify_jwt` | Requisições | Resultado |
|---|---|---|---|
| `ml-webhook` | **true** | 221 | **401 (100%)** — webhooks do ML rejeitados |
| `backfill-faturamento` | **true** | 92 | **401 (100%)** — backfill agendado rejeitado |
| `monitorar-moderados` | false | 3 | 200 ✓ (controle) |
| `notificar-liberacao` | false | 1 | 200 ✓ (controle) |

**Cascata:** `sync-venda`/`sync-pergunta`/`sync-devolucao` são enfileiradas pelo `ml-webhook`.
Como ele retorna 401, nada é enfileirado → faturamento em tempo real **parado** (dados só
entram por backfill manual com JWT de usuário). `reconciliar-faturamento` (schedule, também
`verify_jwt=true`) tende ao mesmo 401.

**Correção (pendente de aprovação + ADR):** definir `verify_jwt=false` no `config.toml` para
`ml-webhook`, `sync-venda`, `reconciliar-faturamento` e `backfill-faturamento` (todas já
autenticam internamente: assinatura QStash e/ou `requireUser`), e **redeployar** essas
funções. Equivale ao que já vale para `sync-pergunta`/`sync-devolucao` (corretas, `false`).
