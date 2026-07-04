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
| ml-webhook | false | Webhook do ML | sim (dedup) |
| sync-venda | false | QStash worker | sim (upsert) |
| sync-pergunta | false | QStash worker | sim (upsert) |
| sync-devolucao | false | QStash worker | sim (upsert) |
| responder-pergunta | true | HTTP (frontend) | não |
| sugerir-resposta-pergunta | true | HTTP (frontend) | não (stateless) |
| backfill-faturamento | false | HTTP (JWT) **ou** QStash | sim (upsert) |
| reconciliar-faturamento | false | QStash schedule | sim (upsert) |
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
  cases em ADR-0013. Grava `familias.origem` a partir da coluna opcional `ORIGEM` da linha PAI
  (ausente/vazio/inválido → `nacional`, ADR-0055). Escopo da operação (ADR-0056): casa anteriores
  por `codigo_pai` em toda a operação (evita duplicar anúncio de outro membro) e grava
  `familias/variacoes.user_id` com o dono da conta ML da operação (o operador fica em `lotes.user_id`).
- **upload-imagens-lote** — recebe FormData de imagens e casa por nome de arquivo
  (`00CODIGO`, `CAPA_…`, `CAPA2_…`, `CAPA3_…`) com variações/família.

### Processamento / publicação
- **process-familia** *(worker)* — claim atômico `pendente→processando`, resolve cor
  (dicionário → Vision → cache Redis), gera copy (OpenRouter), detecta categoria/tipo, monta
  atributos, calcula estratégia de preço (gross-up do PRÓPRIO cobre comissão, **frete**
  grátis do vendedor e **imposto por origem**, ADR-0050/ADR-0055) e análise de mercado;
  marca `pronto`/`erro`. Tipo derivado da
  categoria do preditor quando é uma categoria de aviamento conhecida, e caminho genérico trava
  na Revisão (não publica sem validar os obrigatórios) quando schema/IA falha (ADR-0051).
  `gerarCopy` também extrai `tipo_produto_busca` (substantivo do tipo de produto grounded em
  nome/descrição) — alimenta uma 2ª busca no preditor de categoria (paralela à busca pelo nome
  bruto) e garante o tipo de produto no título quando ausente do nome; candidatos de categoria
  com nome genérico ("Outros" etc.) nunca vencem um candidato específico (ADR-0054), mas sem
  nenhum específico o topo genérico é aplicado como fallback visível (`tipo_origem='generico'`,
  badge de aviso na Revisão) em vez de bloquear a família (ADR-0058); zero candidato ou pista
  forte sem candidato compatível seguem caindo em manual.
- **publicar-familias** — marca famílias `publicando`, garante a fila serial
  (`parallelism=1`) e enfileira os jobs de publicação (ADR-0034). Escopo da operação (ADR-0056):
  publica as famílias selecionadas sem filtrar por chamador; a fila serial é keyed por
  `familias.user_id` (a conta ML), o mesmo id que o worker usa para o token.
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
- **definir-categoria-familia** — grava a categoria escolhida pelo operador (busca livre,
  ADR-0057): `{familia_id, categoria_ml_id, categoria_nome}` (substitui o contrato antigo de 4
  tipos fixos, ADR-0009/0022). Categoria conhecida (linha/fita/botao/cola) → caminho curado
  (`montarAtributosML`); categoria livre/genérica → `resolverAtributosGenericos` (mesmo fluxo
  schema+IA do process-familia, reusado).
- **atributos-familia** *(JWT)* — fallback da Camada 2B (ADR-0052): `action:'faltantes'` lista os
  obrigatórios não preenchidos COM schema (tipo/valores) e `action:'salvar'` valida um valor
  server-side, faz merge em `atributos_ml`, marca `atributos_editados_pelo_operador` e recalcula
  `atributos_faltantes`. Base do editor inline na Revisão. `action:'buscar-categoria'` (ADR-0057)
  busca categorias reais do ML por texto livre (`buscarCategoriaPreditor`) e devolve também a
  sugestão não-vinculante da categoria do concorrente (`concorrencia_categoria_id` →
  `buscarNomeCategoria`), sem exigir categoria já definida.
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
  upsert em `ml_vendas`/`ml_perguntas`/`ml_devolucoes`; alertam Telegram. `sync-venda` também
  envia mensagem automática ao comprador na primeira transição para `paid` (ML Messages API).
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
  Escopo e token da **operação** (todos os anúncios + credencial ML compartilhada), não do chamador (ADR-0056).
- **metricas-vendas** — agrega vendas do período por anúncio gerenciado (mapa GTIN→item).
  Mesmo escopo de operação e credencial ML compartilhada do `status-publicados` (ADR-0056).
- **analisar-viabilidade** — concorrência + comissões + margem antes de cadastrar (ADR-0014/0015);
  margem/"Vale a pena" item-a-item descontam a alíquota de imposto por origem (ADR-0055).
- **calcular-tarifa-ml** — comissões (classic + premium) por preço/categoria + frete que o vendedor absorve (frete grátis ao comprador, via `GET /users/{id}/shipping_options/free`); `recebe = preço − comissão − frete − imposto` (imposto por origem somado ao cálculo client, ADR-0055). Body aceita `dimensoes` (peso/medidas da variação representativa); cache Redis 6h (chave inclui dimensões + vendedor).

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

## Histórico — divergência de `verify_jwt` no faturamento (corrigida)

Entre 2026-06-26 e 2026-06-28, `ml-webhook`, `sync-venda`, `backfill-faturamento` e
`reconciliar-faturamento` estavam com `verify_jwt=true` no `config.toml` mas são acionadas por
QStash/webhook (sem JWT Supabase) — o gateway rejeitava com 401 antes da função rodar,
derrubando o faturamento em tempo real em cascata. Corrigido pelo
[ADR-0046](../decisions/0046-verify-jwt-false-workers-webhook-faturamento.md)
(`verify_jwt=false` nas quatro, autenticação real continua interna por assinatura/JWT). Confirmado
em produção que segue `false`. Detalhe do incidente em
`obsidian-vault/05-Bugs/Incidentes.md`.

## Histórico — catálogo truncado em 1000 linhas quebrava casamento por GTIN (corrigida)

`carregarCatalogo` (`_shared/faturamento/io.ts`) lia `variacoes`/`familias` sem paginação
(`.range()`). Contas com mais de ~1000 variações (teto padrão do PostgREST sem `ORDER BY`) perdiam
produtos silenciosamente do mapa `infoPorGtin` — o casamento "venda de catálogo → PubliAI por GTIN"
(ADR-0037) nunca encontrava esses produtos, mesmo cadastrados há semanas. Sintoma: vendas de
catálogo ficavam permanentemente em "Fora do PubliAI" sem código/EAN (tela Publicados → Detalhe de
vendas). Não era timing nem deploy desatualizado — era truncamento silencioso da query, presente
desde a implementação original do casamento por GTIN (10 dias antes de ser percebido). Corrigido com
`paginarTudo` (mesma técnica de `buscarTodasPaginas` do frontend, `src/lib/paginacao-supabase.ts`)
em `carregarCatalogo`. Redeploy: `sync-venda`, `backfill-faturamento`, `reconciliar-faturamento`,
`ml-webhook`. Backfill reprocessou o histórico e reclassificou os itens afetados. Detalhe em
`obsidian-vault/09-Logs/Changelog.md` (2026-07-03).
