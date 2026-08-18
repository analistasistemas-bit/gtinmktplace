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
- Funções **não listadas** no `config.toml` assumem o **default `true`**.

## Tabela-resumo

| Função | verify_jwt | Trigger | Idempotente |
|---|---|---|---|
| **OAuth / conexão ML** ||||
| ml-oauth-start | false | HTTP (JWT manual) | não |
| ml-oauth-callback | false | Redirect OAuth do ML | não |
| ml-oauth-claim | false | HTTP (JWT manual) | não |
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
| publicar-anuncio | false | QStash (fila serial por canal) | sim (claim atômico por canal) |
| regenerar-copy-familia | false | HTTP (JWT manual) | não |
| definir-categoria-familia | true | HTTP (frontend) | não |
| atributos-familia | true | HTTP (frontend) | não |
| vincular-catalogo | false | QStash (delay 10min) | sim (upsert) |
| **Remoção / reprocessamento** ||||
| remover-publicado | false | HTTP (JWT manual) | sim (guarded) |
| excluir-lote | true | HTTP (frontend) | não |
| reprocessar-familia | false | HTTP (JWT manual) | sim (guard de status) |
| retentar-catalogo | false | HTTP (JWT manual) | sim (re-enfileira vincular-catalogo) |
| invalidar-cache-cor | true | HTTP (frontend) | não |
| reconciliar-user-products | false | HTTP (JWT manual, admin) | sim (upsert atômico) |
| reconciliar-convergencia-up | false | QStash schedule | sim (claim atômico) |
| **Estoque (ADR-0094, Bloco A)** ||||
| sincronizar-estoque | false | QStash (fila serial por org) | sim (push absoluto) |
| reconciliar-estoque | false | QStash schedule | sim (escopo restrito ao ledger) |
| **Estoque (ADR-0094, Bloco B — módulo pago)** ||||
| cadastrar-produto | **true** | HTTP (frontend) | sim (guard 409 + ref no estoque inicial) |
| entrada-estoque | **true** | HTTP (frontend) | sim (`ref` de idempotência obrigatória) |
| ajustar-estoque | **true** | HTTP (frontend, **admin**) | sim (`ref` por item: `ajuste:{ref}:{codigo}`) |
| excluir-produto | **true** | HTTP (frontend, **admin**) | sim (delete por `codigo_pai`; repetir devolve 404) |
| **Faturamento (vendas/perguntas/devoluções)** ||||
| ml-webhook | false | Webhook do ML | sim (dedup) |
| sync-venda | false | QStash worker | sim (upsert) |
| sync-pergunta | false | QStash worker | sim (upsert) |
| sync-mensagem | false | QStash worker | sim (upsert) |
| sync-devolucao | false | QStash worker | sim (upsert) |
| responder-pergunta | true | HTTP (frontend) | não |
| responder-mensagem | true | HTTP (frontend) | não |
| sugerir-resposta-pergunta | true | HTTP (frontend) | não (stateless) |
| backfill-faturamento | false | HTTP (JWT) **ou** QStash | sim (upsert) |
| reconciliar-faturamento | false | QStash schedule | sim (upsert) |
| **Monitoramento / alertas** ||||
| monitorar-moderados | false | HTTP (JWT manual) ou QStash | sim |
| notificar-liberacao | false | QStash schedule | sim (1×/dia BRT) |
| **Pulse (ADR-0119)** ||||
| pulse-coletar | false | HTTP (JWT manual) ou QStash | sim (upsert por dia) |
| pulse-adicionar | true | HTTP (frontend) | sim (upsert por cpid) |
| pulse-sonar | true | HTTP (frontend) | sim (leitura; cache Redis 24h por termo) |
| pulse-sonar-vendas | true | HTTP (frontend) | sim (leitura; cache Redis 24h por termo) |
| **Status / métricas / viabilidade** ||||
| status-publicados | true | HTTP (frontend) | sim (leitura) |
| atualizar-status-publicado | true | HTTP (frontend, admin) | sim (PUT idempotente) |
| metricas-vendas | true | HTTP (frontend) | sim (leitura) |
| analisar-viabilidade | true | HTTP (frontend) | não |
| calcular-tarifa-ml | false | HTTP (JWT manual) | sim (cache 6h) |
| **Acesso / usuários** ||||
| usuarios | true | HTTP (frontend, admin) | sim (upsert/idempotente) |
| suporte | true | HTTP (frontend) | transições condicionais; início/renovação atômicos na RPC |
| **Utilitário** ||||
| hello | false | HTTP (smoke test) | sim |


## Schedules do QStash (cron + body)

Só existem dentro do QStash — **não há schedules-as-code neste repositório**. Esta tabela é a
referência para auditar e recriar. Mantê-la atualizada ao mexer em qualquer cron.

| Função | Cron (UTC) | Body | Retries |
|---|---|---|---|
| `reconciliar-convergencia-up` | `*/15 * * * *` | *(sem body)* | 3 |
| `backfill-faturamento` | `30 6 * * *` | `{"dias":7}` | 3 |
| `monitorar-moderados` | `0 */6 * * *` | *(sem body)* | 3 |
| `reconciliar-faturamento` | `0 * * * *` | *(sem body)* | 3 |
| `notificar-liberacao` | `0 11 * * *` | *(sem body)* | 3 |
| `reconciliar-estoque` | `30 12 * * *` | `{}` | 3 |
| `pulse-coletar` (tier completo) | `0 9 * * *` | `{"tier":"completo"}` | 2 |
| `pulse-coletar` (tier quente) | `0 */6 * * *` | `{"tier":"quente"}` | 2 |

Os dois schedules do `pulse-coletar` (ADR-0119) foram criados em 2026-08-16:
`scd_7whbaAZrFGPAL3JkbWsmNuYb2AVc` (completo) e `scd_5pCHsB95LbDd7cpJMLsJNK8iHNQC` (quente), body
auditado como JSON puro logo após a criação. Cron em UTC: `0 9 * * *` = 06:00 BRT.

⚠️ **Armadilha do body duplamente codificado.** O `backfill-faturamento` é o único schedule que
passa parâmetros, e ficou semanas com `body = '"{\"dias\":30}"'` — uma **string** contendo JSON,
não um objeto. O worker faz `JSON.parse` e recebia string, `dias` virava `undefined` e a janela caía
no default de 90 dias, carga que não cabe numa execução: falhava de hora em hora, calado. Ao criar
ou editar um schedule com body, conferir depois:

```bash
curl -s https://qstash.upstash.io/v2/schedules -H "Authorization: Bearer $QSTASH_TOKEN" \
  | python3 -c "import sys,json;[print(s['cron'], repr(s.get('body'))) for s in json.load(sys.stdin)]"
```

O body tem que aparecer como `'{"dias":7}'` — se vier com aspas escapadas por fora, está errado.
O worker hoje desembrulha e loga um `console.warn`, mas o schedule deve ser corrigido mesmo assim.

---

## Módulos compartilhados (`_shared/`)

| Módulo | Provê |
|---|---|
| `auth.ts` | `requireUser(req)` — valida Bearer token contra o Supabase Auth; `requireAdmin(req)` — idem + exige `profiles.is_admin` (ADR-0060); `requireUserOrg(req)` — idem + resolve `{userId, orgId, isAdmin}` do `profiles` do chamador (403 se inativo/sem org) — identidade padrão por organização (ADR-0027) |
| `cors.ts` | Headers CORS padrão (inclui `upstash-signature`) |
| `supabase.ts` | `adminClient()` (service_role) e `userClient(jwt)` (respeita RLS) |
| `queue.ts` | QStash: `enfileirarFamilia`, `enfileirarPublicacoes` (lote, substituiu `enfileirarPublicacao/Atualizacao/Split` — ver abaixo), `enfileirarVinculacaoCatalogo`, `garantirFilaSerial`, `verificarAssinatura`; **E6 (ADR-0061):** `enfileirarPublicacaoCanal`, `garantirFilaSerialCanal`, `filaCanal` — fila serial por `(canal, org)`. `enfileirarFamilias` (plural, lote #44 03/08) publica em blocos via `enfileirar-em-blocos.ts` (`Client.batchJSON`, até 100/bloco) em vez de 1 publish por família — usado por `ingest-lote` e `reprocessar-familia`, que iteram N famílias; `cadastrar-produto` fica no singular (1 família por chamada). Lógica de blocos/erro parcial (`enfileirados` no erro quando um bloco falha depois de outro já ter publicado) isolada em `enfileirar-em-blocos.ts` sem import Deno, só pra ficar testável pelo vitest do frontend. **Upsert de fila memoizado por nome** (`memoizar-por-chave.ts`, 03/08): `garantirFilaSerial`/`garantirFilaSerialCanal` faziam `queue().upsert()` 1x por item dentro dos loops (`publicar-familias` por família×canal; `despacharPushPendente` até 1000 grupos numa execução do `reconciliar-estoque`) — sempre a MESMA fila. `queues` é endpoint **com** rate limit por segundo na Upstash (publish/batch/enqueue não têm), então era o candidato real a estourar limite. Memoiza a Promise por nome de fila no isolate; falha não é memoizada (o próximo chamador refaz). **`enfileirarPublicacoes`** (lote #45, 03/08): `publicar-familias` marcava as N famílias como `publicando` de uma vez e depois enfileirava UMA POR UMA; o loop morreu no meio com 126 famílias — 68 enfileiradas e **58 presas em `publicando` sem mensagem**, invisíveis (não são `erro`, então o "Reenviar"/`reprocessar-familia` nem as alcançava) e só recuperáveis por reenfileiramento manual. Agora é 1 batch por (dono, alvo) na mesma fila serial, devolvendo os messageIds na ordem de entrada; se o batch falhar, as famílias sem mensagem viram `erro` com a causa (recuperáveis pela UI). Substituiu `enfileirarPublicacao`/`enfileirarAtualizacao`/`enfileirarSplit`, que eram idênticas exceto pelo worker de destino. |
| `ml/*` | Integração ML: `token.ts` → `getValidAccessTokenConexao(conexao)` (token da **conexão** da org, ADR-0027; substitui o antigo `getValidAccessToken(userId)`), criar/atualizar item, descrição, concorrência, catálogo, tarifa, atacado. **`anuncio-atualizavel.ts`** (lote #45, 03/08): guard entre o GET e o PUT do UPDATE — anúncio `closed`/`inactive` ou com sub_status `deleted`/`forbidden` falha alto com a causa certa ("Anúncio removido no Mercado Livre — republique") em vez do erro cru do ML (`variations is not modifiable ... Revise os atributos da categoria`), que apontava o operador para um lugar onde não havia nada a revisar. `paused` **não** bloqueia (é o estado de quem zerou estoque, ADR-0060, e repor é o caminho de volta); status desconhecido/transitório (`under_review`) também não — fail-open deliberado, para não travar em silêncio uma atualização que funcionaria. `buscarItemML` passou a pedir `status,sub_status` no GET. |
| `ai/*` | OpenRouter: copywriter, vision (cor), título, resposta a pergunta, categoria/atributos por LLM; `modelos.ts` → `resolverModeloTexto(admin, orgId)` (ADR-0074) lê `configuracoes.ai_model_texto` da org e cai no fallback `MODELO_COPY`/env em `null`/erro (nunca propaga) |
| `canais/*` | Conector multicanal: `getConnector(canal)` + contrato + `MercadoLivreConnector`; `conexao.ts` → `resolverConexao(admin, orgId, canal)` resolve a `marketplace_connections` da org (ADR-0027); **E6 (ADR-0061):** `estado.ts` → máquina de estado por canal (`garantirAnuncioExterno`, `claimAnuncioExterno`, `decidirOperacaoCanal`); `registry.ts` suporta conectores injetáveis em teste (`registrarConectorParaTeste`); `fake.ts` conector de teste |
| `redis/*` | Client Redis + caches (cor, concorrência, tarifa) |
| `faturamento/*` | I/O de vendas/perguntas/devoluções + enriquecimento (líquido, EAN); `resolverIdentidade`/`resolverOrgPorUserId` (`io.ts`) resolvem `{userId, orgId}` via `marketplace_connections` (ADR-0027). **`carregarCatalogo` tem escopo de ORG** (2026-08-11): recebe o `userId` do `criado_por` da conexão mas filtra `familias`/`variacoes` por `org_id` — filtrar por `user_id` deixava de fora todo produto cadastrado por outro membro, e a venda vinha com `is_publiai = false` e sem código, sem baixar estoque. Só cai para `user_id` quando não há conexão para resolver a org. O código do item ainda tem um 3º fallback: `seller_custom_field`/`seller_sku` do próprio pedido, que **não** promove o item a `is_publiai` |
| `mercadopago/*` | Leitura de pagamentos MP com o token da conexão `mercado_livre` da org (ADR-0093). `buscarPagamentoMP` (1 id) nos workers de evento; `buscarPagamentosMP` (varredura por período) nos de lote |
| `categoria/*`, `cor/*`, `preco/*` | Detecção de categoria, extração de cor, lógica de preço/desconto |
| `estoque/*` (ADR-0094) | `baixa.ts` → `registrarBaixaVenda`/`estornarVendaCancelada` (chamam as RPCs `baixar_estoque`/`estornar_estoque`), `lerPushPendente`/`despacharPushPendente` (drena o outbox do ledger); `alvos.ts` → `resolverAlvosPush` (resolve qual item externo recebe qual SKU: variações num item, split em N partições, ou N itens planos user products) |
| `notificacoes/*` | Telegram: `montarMensagem*` + `enviarTelegram` (`telegram.ts`); `notificarCategoria(admin, orgId, categoria, texto)` resolve os assinantes por categoria, grava notificação in-app (tabela `notificacoes`, ADR-0085) e envia Telegram a quem tem chat_id (`config.ts`); `categorias.ts` (7 categorias canônicas) e `sanitizarDestinatario` (`destinatario.ts`). Assinatura por profile (`telegram_categorias`) vale para os dois canais; bot Telegram é por org (ADR-0068) |
| `parser.ts` | Validação de colunas da planilha, agrupamento por PAI, matching de fotos |

---

## Por domínio

### OAuth / conexão ML
- **ml-oauth-start** — gera `state` (UUID, TTL 10min no Redis, guarda `{user_id, org_id}` —
  ADR-0027) e monta a URL de autorização. Secrets: `ML_CLIENT_ID`, `ML_REDIRECT_URI`.
- **ml-oauth-callback** — **não grava mais a conexão nem troca o `code`** (ADR-0091). Consome o
  `state` (`GETDEL`, uso único), guarda o `code` no Redis em `oauth:ml:claim:<id>` com TTL de
  300s e redireciona para o front com `ml_claim=<id>`. Endpoint público (redirect do ML), por
  isso não pode ser fonte de autorização.
- **ml-oauth-claim** — troca o `code` por token e grava via `upsert_marketplace_connection`,
  usando a org do **chamador autenticado** (`requireUserOrg` + admin, ADR-0060). É a correção do
  achado F4: antes o `p_org_id` vinha do `state`, então um admin de qualquer org mandava a
  authUrl para um vendedor e recebia os tokens dele. Invariante: **não lê org de lugar nenhum
  além do `requireUserOrg`**. Traduz o 23505 do índice `(canal, conta_externa_id)` para "conta já
  conectada em outra organização". `verify_jwt=false` acompanhando as irmãs de OAuth, com a
  checagem dentro da function. Também checa `GET /users/{id}/shipping_preferences` (`"me2"` em
  `modes`) e grava `me2_habilitado` — best-effort, `null` se a chamada falhar. `_shared/ml/token.ts`
  (`getValidAccessTokenConexao`, chamada por toda função que precisa de token ML) relê e repassa
  esse valor a cada refresh de token (~6h) — sem isso, `upsert_marketplace_connection` zerava a
  coluna de volta pra `null` em todo refresh (adendo ADR-0095, 2026-07-31).
- **ml-oauth-disconnect** — remove a conexão (`delete_marketplace_connection`).

### Ingest de planilha
- **ingest-lote** — valida colunas, agrupa variações por PAI, casa fotos, detecta CREATE vs
  UPDATE, cria `familias`+`variacoes` e enfileira as pendentes (`enfileirarFamilia`). Edge
  cases em ADR-0013. Grava `familias.origem` a partir da coluna `ORIGEM` da linha PAI, que é
  **obrigatória e explícita** (ADR-0107): a coluna está em `COLUNAS_OBRIGATORIAS` e
  `exigirOrigemExplicita` aborta o lote se qualquer PAI vier vazio ou com valor fora de
  `NACIONAL`/`IMPORTADO`, listando todos os códigos de uma vez — o default silencioso em
  `nacional` cobrava 8% em importado (16%). `verificarOrigemInviolavel` (ADR-0055) continua
  guardando o outro flanco: a origem persistida tem que bater com a coluna crua da planilha.
  Escopo da operação (ADR-0056): casa anteriores
  por `codigo_pai` em toda a operação (evita duplicar anúncio de outro membro) e grava
  `familias/variacoes.user_id` com o dono da conta ML da operação (o operador fica em `lotes.user_id`).
  No re-ingest UPDATE herda o `*_ml_picture_id`/`ml_picture_id` só quando NÃO veio foto nova no lote
  (reposição só-planilha preserva a publicada); com foto nova, zera para forçar re-upload da atual —
  senão republicaria a imagem antiga cacheada no ML (plano 031, `herdarPictureId`).
- **upload-imagens-lote** — recebe FormData de imagens e casa por nome de arquivo
  (`00CODIGO`, `CAPA_…`, `CAPA2_…`, `CAPA3_…`) com variações/família.

### Processamento / publicação
- **process-familia** *(worker)* — claim atômico `pendente→processando`, resolve cor
  (dicionário → Vision → cache Redis), gera copy (OpenRouter), detecta categoria/tipo, monta
  atributos, calcula estratégia de preço (gross-up do PRÓPRIO cobre comissão, **frete**
  grátis do vendedor e **imposto por origem**, ADR-0050/ADR-0055) e análise de mercado;
  marca `pronto`/`erro`. **LOUD do imposto (ADR-0086):** cedo, se a org não confirmou as alíquotas
  (`configuracoes.aliquotas_confirmadas_em` null) a família vira `erro` "confirme as alíquotas" — nunca
  precifica com 8/16 em silêncio (vale p/ CREATE e UPDATE); erro transitório de config volta a
  `pendente` (retry). Busca de concorrência (ADR-0064) agora agrega **TODAS as variações
  válidas** em paralelo (pool 6 workers, cap 60 GTINs) → menor preço global, faixa min–max,
  vendedores distinto, produto representativo = mais barato. Negative caching por GTIN
  (tombstone 6h) elimina buscas inúteis a cada reprocess. Com o toggle
  `configuracoes.reancora_lider_ativa` ligado (ADR-0065), quando o preço competitivo dá
  prejuízo real (líquido Clássico < custo) a família é reancorada no **preço do MercadoLíder
  com mais vendas** (entre concorrentes `power_seller_status ≠ null`; empate de vendas
  desempata pelo menor preço; vendedor com múltiplas cores usa o menor preço dele) × desconto,
  gravando `familias.preco_reancorado_lider`; nunca sobe acima desse preço nem faz gross-up —
  exceto o piso do abismo de tarifa fixa (ADR-0075): qualquer preço competitivo (mercado puro ou
  reancorado) abaixo de R$12,55 é elevado a R$12,55, mesmo que exceda o preço do líder.
  Tipo derivado da
  categoria do preditor quando é uma categoria de aviamento conhecida, e caminho genérico trava
  na Revisão (não publica sem validar os obrigatórios) quando schema/IA falha (ADR-0051).
  `gerarCopy` também extrai `tipo_produto_busca` (substantivo do tipo de produto grounded em
  nome/descrição) — alimenta uma 2ª busca no preditor de categoria (paralela à busca pelo nome
  bruto) e garante o tipo de produto no título quando ausente do nome; candidatos de categoria
  com nome genérico ("Outros" etc.) nunca vencem um candidato específico (ADR-0054), mas o
  genérico da lista é aplicado como fallback visível (`tipo_origem='generico'`, badge de aviso
  na Revisão) sempre que o fluxo abandonaria um específico — sem candidato específico, ou com
  candidato(s) mas a IA de desempate abstém do falso-amigo — em vez de bloquear a família
  (ADR-0058, adendo 2026-07-04); só cai em `manual` quando não sobra genérico nenhum pra resgatar.
  **Título (ADR-0099):** `gerarCopy` devolve dez slots nomeados (`produto`, `marca`, `modelo`,
  `medida`, `quantidade`, `material`, `variacao`, `compatibilidade`, `aplicacao`, `sinonimo`) em
  vez de uma string; a montagem é 100% determinística em `posProcessarTitulo`
  (`_shared/ai/titulo-pos.ts`), único ponto chamado pelos três call sites (`process-familia`,
  `regenerar-copy-familia`, `titulo-particao.ts`). Pipeline, nesta ordem: `normalizarSlots`
  (higieniza e canonicaliza unidade) → `aplicarGuardsTitulo` (crava o que a fonte garante —
  dimensão/metragem/largura, quantidade, cor única como discriminador, correção de sinônimo de
  tipo de fio ex-`garantirTipoFioTitulo`/ADR-0070, marca via mapa) → `validarSlotsAncorados`
  (derruba marketing não-ancorado e adjetivo vazio, exige respaldo pra marca/sinônimo) →
  `montarTitulo` (`_shared/ai/titulo-montar.ts`, reduz e corta por prioridade, protegendo
  `produto`/`medida`/`variacao` discriminadora; lança `TituloInviavelError` se nem assim couber
  em 60 chars). Guards antigos por string (`garantirTipoFioTitulo`, `garantirLarguraTitulo`,
  `garantirMetragemTitulo`, `garantirTipoProdutoTitulo`, `garantirCorTitulo`) foram removidos
  nesta migração; suas garantias vivem agora em `_shared/ai/titulo-guards.ts`.
  **`termos_com_risco` (ADR-0100):** `gerarCopy` devolve um 11º campo, irmão de `titulo_slots` e
  nunca dentro dele — lista de termos comuns da categoria que o modelo julgou prováveis mas não
  achou na fonte (`["HB", "Escolar"]` para um lápis `N.2`). Existe para o termo ter destino
  legítimo em vez de ser embutido num slot; como não é slot, `posProcessarTitulo` não o alcança e
  ele **nunca chega ao título**. Coagido por `coagirTermosComRisco` (descarta não-string, dedup,
  teto de 10) e apenas logado — não é persistido, então não serve a censo, só a diagnóstico.
  **Marca (ADR-0101):** o mapa razão social → marca (`titulo-marcas.ts`) só sobrescreve o slot
  quando a IA não trouxe marca OU quando a forma do mapa está ancorada na fonte. O fornecedor é
  muitas vezes o fabricante e não a marca (ECOFIBRA fabrica EUROROMA), e a substituição
  incondicional fazia `validarSlotsAncorados` derrubar a substituta logo depois — 52 de 304
  famílias ficavam sem marca nenhuma. A exigência de ancoragem não mudou; mudou qual grafia é
  submetida a ela.
  **Diagnóstico (ADR-0116):** `diagnosticarTitulo` roda esse mesmo pipeline e devolve, junto com
  o título, o que cada etapa alterou ou removeu (`{slot, etapa, de, para}`, etapas
  `normalizacao|guards|ancoragem|corte`), persistido em `familias.titulo_descartes`.
  `posProcessarTitulo` virou um wrapper de uma linha sobre ele — não há segundo pipeline para
  divergir do primeiro. O `corte` é comparado por PRESENÇA (`montarTituloDetalhado` devolve os
  slots sobreviventes), não por diff de valores, porque ele remove o slot inteiro em vez de
  reescrevê-lo. Puramente diagnóstico: nenhuma decisão do pipeline lê a coluna.
  **Tema comemorativo (ADR-0115):** `cravarTema`, dentro de `aplicarGuardsTitulo`, injeta o tema
  (lista fechada: Natal, Páscoa, Halloween, Festa Junina, Dia das Mães…) no slot `produto`, que é
  incortável, quando a fonte o declara e a IA o descartou. Prefixa `Estampa` só quando a fonte
  fala de estampa. Teto de 40 chars em `produto`: estourando, o tema é abandonado, porque cravar
  em slot incortável transformaria um título viável em `TituloInviavelError`. Existe porque a
  instrução equivalente no prompt foi medida e falhou — o modelo devolveu `produto="Tecido Oxford
  Liso"` com 23 caracteres sobrando.
  **Eixo de variação (ADR-0115):** `_shared/ai/eixo-variacao.ts` deriva o eixo da família do
  SUFIXO do nome de cada variação em relação ao `nome_pai` (`… Est.6` → `Estampa 6`), não da cor.
  O rótulo da seção da descrição vem da palavra da fonte: `🎨 ESTAMPAS DISPONÍVEIS`,
  `🎨 VARIAÇÕES DISPONÍVEIS` ou, sem sufixo discriminante, o `🎨 CORES DISPONÍVEIS` de sempre.
  Corrige uma família de 7 estampas de Natal anunciada como "Verde Musgo / Vermelho" — as cores
  que o Vision leu nas fotos. `atualizarSecaoCores` (`_shared/ml/criar-item.ts`) reconhece os três
  rótulos e preserva o existente ao reescrever a lista no UPDATE.
  `garantirLarguraDescricao`/`garantirMetragemDescricao` (`_shared/ai/copywriter-prompt.ts`)
  cravam largura (mm ou cm) e metragem (grounded em nome/descrição da planilha) na seção "📌
  ESPECIFICAÇÕES" da descrição, criando a seção se a IA a tiver pulado inteira — mesma classe de
  rede de segurança dos guards de título, mas na descrição, onde não havia nenhuma (bug lote
  02994771); `extrairLargura`/`extrairMetragem` moram em `_shared/ai/titulo.ts` e são reusados
  pelo bloco de dimensão do título — reconhecem as duas unidades porque a planilha mistura mm/cm
  entre nome_pai e descricao_pai do mesmo produto (achado: franjas com "5MM" no nome mas "5 CM DE
  LARGURA" na descrição). Metragem emitida na descrição é canônica (`50m`, nunca `50MT`) desde
  ADR-0099 — a mesma mudança de unidade do título, não declarada originalmente nesse ADR.
  **Pré-upload de foto (ADR-0033, 2026-07-10):** sobe ao ML as fotos ainda sem `picture_id` e
  persiste o id (`_shared/anuncios/pre-subir-fotos.ts`), tirando a propagação (~2,5 min) do caminho
  crítico do publish — no `POST /items` o id já está pronto e o anúncio publica em segundos.
  Best-effort/idempotente; a troca de foto zera o `*_ml_picture_id` (`upload-imagens-lote` e o
  re-ingest UPDATE de planilha via `herdarPictureId`, plano 031).
- **publicar-familias** — marca famílias `publicando`, garante a fila serial
  (`parallelism=1`) e enfileira os jobs de publicação (ADR-0034). **E6 (ADR-0061):** aceita
  `canais[]` (default `['mercado_livre']`); fan-out: ML segue no worker `publish-familia-ml`;
  cada canal ≠ ML enfileira para o worker genérico `publicar-anuncio` via fila serial
  `publish-{canal}-{orgId}`. Escopo da operação (ADR-0056): publica as famílias selecionadas
  sem filtrar por chamador. **Controle de preço no UPDATE (ADR-0078, Fase 1):** body aceita os
  campos opcionais `somente_estoque_global` (boolean, default false) e
  `somente_estoque_overrides` (`string[]` de `familia_id`); a escolha é resolvida por-família por
  `resolverSomenteEstoque(id, global, overrides)` (override inverte o global) e viaja no payload
  do job (idempotência do retry QStash).
  **Roteamento split (ADR-0078 F2):** decide entre worker de anúncio único e split (`publicar-split-ml`)
  via `decidirSplit` (`decidir-split.ts`): >100 cores incluídas, OU preços de publicação divergentes
  entre as variações, OU produto já particionado (mais de 1 linha em `anuncios_externos`) — qualquer
  um dos três roteia pro split.
- **publish-familia-ml** *(worker, CREATE)* — sobe fotos, cria o item no ML, aplica atacado
  (PxQ), espelha em `anuncios_externos` e enfileira o vínculo de catálogo com delay. Reusa
  `picture_id` em retry (idempotência). Retry de foto: ADR-0033.
  **Preço uniforme (ADR-0078 F2):** `garantirPrecoUniforme` recusa (400 LOUD, nada enviado) quando
  as variações têm preços de publicação divergentes — sinal de roteamento errado; a família deveria
  ter ido para o split por faixa de preço (`publicar-split-ml`).
  **Item plano (ADR-0084/ADR-0087):** categorias que exigem `family_name` não aceitam o array
  `variations` — `montarPayloadItem` monta um item plano (`price`/`available_quantity` no corpo raiz,
  sem `title`/`original_price`) quando há exatamente 1 variação; falha alto com >1. `MLB271227` (Zíperes)
  segue como seed direto no `Set` (`categoriaExigeFamilyName`), mas categorias novas não precisam mais
  entrar nesse `Set` manualmente: `criarAnuncio` detecta a assinatura exata do 400
  (`precisaItemPlano`, `cause_id` 369+374) reativamente e refaz o `POST` uma vez em formato plano.
  **GTIN (ADR-0116):** `gtinAusente` (`_shared/ml/publicar.ts`) decide entre mandar o atributo
  `GTIN` e mandar `EMPTY_GTIN_REASON`. Conta como ausência: vazio, código interno `3000*`,
  comprimento fora de 8/12/13/14 **e dígito verificador GS1 errado** — este último desde o lote
  #46 (`48251671`, importado), cujo CREATE inteiro caía com "Product Identifier [GTIN] contains
  values with invalid format". O mesmo predicado guarda a busca de catálogo
  (`buscarProdutoCatalogoPorGtin`). O operador corrige ou apaga o GTIN direto na Revisão.
  **User Products / multi-cor (ADR-0088):** categoria UP com >1 variação (`criarAnuncio` devolve
  `FORMATO_INCOMPATIVEL`) roteia pra saga `_shared/user-products/publicar-grupo.ts`
  (`publicar-familia-up.ts` orquestra): cria N itens técnicos separados (1 por SKU/cor) linkados pelo
  mesmo `family_id`, cada um pausado→confirmado→ativado; só libera `familias.status='publicado'`
  quando todos os SKUs esperados (`anuncios_externos.skus_esperados`) estão ativos. Cache de formato
  por conexão+categoria em `ml_formato_publicacao` (seed só na assinatura reativa confirmada). Itens
  técnicos ficam em `anuncios_externos_itens`; vendas/moderação/status (`metricas-vendas`,
  `monitorar-moderados`, `status-publicados`) já unem esses IDs ao escopo da família. Vinculação de
  catálogo (ADR-0021) já cobre o caminho UP (`vincular-catalogo`, ver abaixo). UPDATE por item filho
  (reposição + add/retirar cor) já cobre o caminho UP (`update-familia-ml`, ver abaixo); reconciliador
  de convergência automatizado (`reconciliar-convergencia-up`, schedule QStash) também já cobre —
  "Reenviar" manual continua funcionando como caminho alternativo.
- **update-familia-ml** *(worker, UPDATE)* — extraído em `index.ts` (thin) + `processar.ts`
  (`processarAtualizacaoFamilia`, testável). **User Products (ADR-0088 Fase 2):** ANTES da lógica
  Legacy, detecta família UP pela presença de linhas em `anuncios_externos_itens` (raiz partição 0) e
  roteia para a mini-saga de composição (`_shared/user-products/atualizar-familia-up.ts` →
  `atualizar-composicao.ts`). 100% `GET`-ao-vivo, não usa o cache de formato. Reposição pura
  (`atualizarItemPlanoML` por item filho); mudança de composição (add/retirar cor) reescreve
  `skus_esperados` + liga `mudando_composicao=true` ANTES de qualquer chamada remota, muta (cor nova
  genuína → CREATE plano; cor readicionada `retirado=true` → REATIVA, nunca recria; cor retirada →
  pausa), confirma por `GET` (cor nova `active` + `family_id` da partição; retirada `paused`), só
  então liga `retirado=true` e limpa `mudando_composicao`. Crash no meio deixa `mudando_composicao`
  persistido → a próxima execução (retry QStash/"Reenviar") retoma do estado real das linhas
  (idempotente para reexecução SEQUENCIAL, não concorrente). `family_id` divergente → cor nova em
  `erro` (cores vivas intocadas — família publicada não é derrubada). Legacy abaixo (inclui o
  item-plano-1-variação do ADR-0084, que NÃO tem linhas filhas) fica intocado.
  **Família migrada pelo ML (ADR-0104):** o ML migra categorias para User Products sozinho, em
  anúncios JÁ publicados — uma família publicada como Legacy não tem linhas filhas, então o atalho
  de roteamento acima não a enxerga. O conector detecta pelo `GET` ao vivo (`variations: []` +
  `family_name`) e devolve **`MIGRADO_PARA_UP`** tipado (com `family_id`/`family_name`/`seller_id`
  observados) em vez de lançar — simétrico ao `FORMATO_INCOMPATIVEL` do CREATE; **zero `GET` extra**,
  reusa o que o conector já fazia. O worker então roda `adotar-familia-migrada.ts`: busca cada SKU
  **já publicado** por `seller_custom_field`, valida por multiget (seller, `family_id`,
  `user_product_id`, não-Legacy, status conhecido) e exige **todos sob um único `family_id`** —
  qualquer desvio aborta a adoção **inteira** com as contagens observadas na mensagem (400
  definitivo). **Só leitura remota:** o contrato `PortasAdocao` não expõe escrita no ML. A gravação
  é a RPC `adotar_familia_migrada_up` (raiz + N filhos + `ml_variation_id` nulado + `ml_item_id`
  re-apontado, 1 transação); em seguida a família segue pela saga UP no MESMO attempt.
  Limite conhecido: irmãos **fora da planilha** ficam sem linha filha (vendas deles não são
  atribuídas até um lote futuro incluir a cor) — ver ADR-0104 §2.
  **`somente estoque` nunca muda composição (ADR-0104 §4):** com `somenteEstoque`, `paraRetirar` e
  `paraAdicionar` são sempre vazios — nenhuma cor é pausada por estar ausente da planilha, nenhuma
  cor nova é criada, `skus_esperados` não é reescrito e `mudando_composicao` não é ligado. Antes
  disso o caminho UP divergia do Legacy (que mapeia sobre as variações VIVAS do `GET` e preserva a
  cor omitida) e **pausava anúncio numa reposição pura**, contra o texto do ADR-0089.
  **Sincronização de descrição (2026-07-23):** `efeitosPosComposicao` recalcula a seção "🎨 CORES
  DISPONÍVEIS" (`atualizarSecaoCores`, agora também **recria** a seção quando ausente — antes só
  sabia removê-la) e empurra pra TODOS os N itens ativos incondicionalmente (não só quando o texto
  muda — um push anterior falho nunca seria reparado se o gate fosse por diff de texto). Resultado
  durável em `familias.descricao_status`/`descricao_erro` (mesmo padrão de `atacado_status`/
  `atacado_erro`), badge `descrição ⚠` na Revisão só quando há erro; falha ao gravar o próprio
  status também propaga (nunca mascara silenciosamente, aproveita o retry QStash existente).

  **Legacy** (abaixo) — repõe estoque em cores casadas, cria variação
  para cor nova, sincroniza marca/dimensões, atualiza descrição só se mudou; atacado e catálogo.
  **Item plano (ADR-0084):** mesma categoria, mesma restrição — `atualizarAnuncio` detecta `GET`
  sem `variations` e faz PUT plano (`atualizarItemPlanoML`) quando há exatamente 1 existente e
  nenhuma cor nova; sem isso o PUT `{variations: []}` era aceito pela ML como no-op silencioso.
  Renomeia a cor de variação já publicada (envia COLOR só quando muda vs. o ML — ADR-0062; o ML
  pode recusar em variação com vendas). Fotos comuns (capa2/capa3) só são reenviadas ao criar cor
  nova — reposição/rename não toca fotos (evita duplicação na galeria, ADR-0062). Erro de foto ainda
  propagando: retenta via QStash reusando o `picture_id`; limpa o cache só ao esgotar (ADR-0033).
  Lista de cores da descrição exclui cor indefinida (`'Outra'` do Vision, `ehCorIndefinida()`) antes
  de sincronizar — mesmo guard do CREATE (ADR-0044, adendo 2026-07-10).
  **Controle de preço no UPDATE (ADR-0078, Fase 1):** em "somente estoque", NENHUM push de preço —
  nem `price`/`original_price` (nem pelo ramo de desconto), nem `precoFamilia`, nem reaplicação de
  atacado (PxQ). Cor nova (que exige `price` no PUT) adota o **preço vivo do anúncio** (do GET que
  o conector já faz); sem preço vivo válido → falha LOUD (`status 400`, definitiva, sem retry).
  `variacoes.preco_publicado_ml` é gravado por SKU no sucesso do update (base do badge "preço
  alterado"); em "somente estoque" grava o preço vivo (não o recalculado).
  **Preço uniforme (ADR-0078 F2):** fora de "somente estoque", `garantirPrecoUniforme` aplica o
  mesmo guard do CREATE antes de qualquer envio (400 LOUD em preços divergentes); em "somente
  estoque" o guard é pulado (nenhum preço seria enviado de qualquer forma).
- **reconciliar-convergencia-up** *(schedule QStash — ADR-0088, 2026-07-23)* — retoma em background
  raízes User Products travadas em `mudando_composicao=true` (mudança de composição interrompida
  por crash), reusando a mesma mini-saga do `update-familia-ml` (`atualizarFamiliaUP`) por completo.
  Extraído em `index.ts` (thin) + `processar.ts` testável, mesmo padrão dos outros workers.
  Janela anti-corrida de 15min antes de listar (dá tempo do worker normal do UPDATE, se estiver em
  andamento, terminar sozinho) + **claim atômico** (`reconciliar_convergencia_claim`, RPC):
  re-checa `mudando_composicao=true` e `atualizado_em` velho no MESMO `UPDATE` que incrementa
  `reconciliacao_tentativas` — zero linhas afetadas = perdeu o claim (outra execução, ou o worker
  normal, já tocou a raiz), pula sem processar. Resolve a família EXATA do episódio por
  `mudando_composicao_familia_id` (nunca por recência — múltiplas linhas de `familias` compartilham
  `codigo_pai`); sem essa referência (só possível em episódios anteriores à migration), fica
  `sem_familia_referenciada`, visível pro "Reenviar" manual resolver. Guard de segurança: todo SKU
  do snapshot `skus_esperados` precisa ter dado fonte em `variacoes` atuais — sem essa checagem,
  `reposicao()` zeraria estoque de um SKU sem entrada, ativo ou não. Rede de segurança adicional:
  quando a saga retorna `estado:'ok'` via `sem_mudanca` (early-return que nunca limpa
  `mudando_composicao` no caminho normal, pois já roda com a flag false), este adapter força
  explicitamente `mudando_composicao=false`/`reconciliacao_tentativas=0`/
  `mudando_composicao_familia_id=null` na raiz — falha nesse UPDATE de limpeza propaga (nunca
  reporta convergência falsa com a raiz ainda travada). **Risco residual aceito** (mesma classe de
  "sem lock" já aceita no resto do ADR-0088): o claim fecha a corrida entre 2 execuções do
  reconciliador e contra um worker que já tocou a raiz ANTES do claim, mas não cria um lease que
  sobreviva um worker que comece um instante DEPOIS do claim — mitigado pela janela anti-corrida de
  15min. Schedule QStash criado em produção (2026-07-24): `*/15 * * * *`, 3 retries
  (`scd_5P1xe886r5SXj6ywwfUdEvY1stKn`).
- **publicar-split-ml** *(worker, split — ADR-0048 + ADR-0078 F2)* — produto que excede 100 cores,
  OU tem preços de publicação divergentes, OU já está particionado publica em N anúncios
  ("partições"); `publicar-familias` roteia esses três casos pra cá (`decidirSplit`, ver acima).
  **Particionamento por preço (ADR-0078 F2):** `particionarPorPreco` particiona primeiro pela faixa
  de preço (centavos inteiros); dentro do mesmo grupo de preço vale a regra alfabética/100 do
  ADR-0048 de sempre. Ancoragem é absoluta (cor já publicada nunca migra de partição); cor ancorada
  cujo preço diverge do resto da sua partição é conflito → 400 LOUD, nada é enviado (operador decide
  na Revisão: repreçar uniforme, marcar "somente estoque" ou remover+republicar). A faixa "viva" de
  cada partição vem de `preco_publicado_ml` das cores ancoradas, com fallback a um GET ao vivo
  (`lerStatus`) quando "somente estoque" não tem esse dado local. Título distinto por IA por
  partição, cap de estoque (99.999) via conector. Grava o item da partição cedo (anti-duplicação em
  retry); partição 0 herda `ml_item_id` existente. Catálogo por-partição é follow-up (hoje cobre só
  a partição 0). Retry de foto via QStash (ADR-0033).
  **Desconto/atacado por grupo de preço (ADR-0078 F2):** `resolverConfigGrupo` resolve a config
  efetiva de cada partição a partir das colunas por-variação (herança NULL do família-level; LOUD em
  config divergente dentro do mesmo grupo; LOUD se um produto com preços divergentes herdaria config
  família-level ATIVA sem confirmação explícita por faixa). Atacado (PxQ) é aplicado por partição na
  base do preço do grupo; `anuncios_externos.atacado_status`/`atacado_erro` guardam o resultado por
  partição, agregados em `familias.atacado_status` no fim (`agregarAtacadoStatus`: algum erro → erro,
  senão algum aplicado → aplicado).
  **Controle de preço no UPDATE (ADR-0078, Fase 1):** mesmo comportamento do `update-familia-ml` no
  ramo UPDATE — em "somente estoque" nenhum push de preço/atacado; cor nova adota o preço vivo do
  anúncio (falha LOUD sem preço vivo válido); `preco_publicado_ml` gravado por SKU no sucesso
  (preço vivo em "somente estoque", recalculado caso contrário).
  **A partir da F2b**, a Revisão permite criar a divergência (prompt "aplicar às demais?" + config
  por faixa); o roteamento e o LOUD descritos acima passam a ser exercitados pela UI.
- **publicar-anuncio** *(worker genérico, E6 — ADR-0061)* — publica 1 família em 1 canal ≠ ML.
  Claim atômico por `(org, canal, codigo_pai)`: `pendente|erro → publicando`. Resolve a conexão da
  org, monta anúncio canônico, executa CREATE/UPDATE via conector, persiste em `anuncios_externos`.
  Idempotência: claim já ocupado (publicando/publicado) → devolve 200 sem reprocessar. Fila serial
  por `(canal, org)` garante rate limit por conta de vendedor (D-E6.4). Transitório (5xx/429) →
  mantém `publicando` e retorna 500 para o QStash retentar.
- **regenerar-copy-familia** — regera título/descrição via IA sem republicar.
- **definir-categoria-familia** — grava a categoria escolhida pelo operador (busca livre,
  ADR-0057): `{familia_id, categoria_ml_id, categoria_nome}` (substitui o contrato antigo de 4
  tipos fixos, ADR-0009/0022). Categoria conhecida (linha/fita/botao/cola/cursor, ADR-0083) → caminho curado
  (`montarAtributosML`); categoria livre/genérica → `resolverAtributosGenericos` (mesmo fluxo
  schema+IA do process-familia, reusado). Depois da IA, dois preenchimentos determinísticos fecham
  obrigatórios que ela não cobre: `preencherUnitsPerPack` (kit) e `preencherNomeObrigatorio`
  (`NAME` = nome do produto quando a categoria o exige — adendo ADR-0052, lote #11).
- **atributos-familia** *(JWT)* — fallback da Camada 2B (ADR-0052): `action:'faltantes'` lista os
  obrigatórios não preenchidos COM schema (tipo/valores) e `action:'salvar'` valida um valor
  server-side, faz merge em `atributos_ml`, marca `atributos_editados_pelo_operador` e recalcula
  `atributos_faltantes`. Base do editor inline na Revisão. `action:'buscar-categoria'` (ADR-0057)
  busca categorias reais do ML por texto livre (`buscarCategoriaPreditor`) e devolve também a
  sugestão não-vinculante da categoria do concorrente (`concorrencia_categoria_id` →
  `buscarNomeCategoria`), sem exigir categoria já definida.
- **vincular-catalogo** *(worker, delay 10min)* — opt-in de catálogo por GTIN; uma decisão unificada
  por rodada reagenda `pendente` **e** `nao_elegivel` pelo mesmo backoff limitado
  (1h/6h/24h/48h; janela total de ~3,3 dias) ou finaliza e alerta via Telegram em
  no-match/ficha divergente/elegibilidade esgotada/elegibilidade não resolvida (ADR-0021/0036).
  **Revisão 2026-08-12 (spec `catalogo-em-risco`):** `pendente` dividia antes só o retry curto do
  QStash (minutos) — como a elegibilidade do ML leva horas ou dias, o retry esgotava e a família
  congelava para sempre (93 famílias / 296 variações em produção). O HTTP 500 ficou reservado para
  falha real: token, rede ou leitura da elegibilidade — esta última passou a **propagar** em vez de
  devolver resumo zerado, que finalizaria a rodada sem ter perguntado nada (mesmo guard aplicado ao
  caminho UP, onde a falha de leitura persistia `catalog_status='erro'` definitivo).
  O worker aceita `alertar: false` no **body do job**: suprime só o envio do Telegram e é propagado
  nos reagendamentos, para o backfill rodar sem enxurrada de mensagens. Job sem o campo (todas as
  publicações normais) alerta como sempre; `queue.ts` não conhece o campo de propósito, para não
  arrastar a frota QStash inteira no deploy. **Revisão 2026-08-14:** opt-in recusado porque o item ML
  ainda está `under_review` conta como `nao_elegivel` (mesmo backoff/alerta), não como `erro`
  terminal. **ADR-0088 Fase 2:** roteia por
  família Legacy (1 item, N variações — `vincularVariacoesCatalogo`) ou User Products (N itens
  filhos, cada cor seu próprio item ML sem `variations[]` — `vincularItensCatalogoUP`), detectado
  pela presença de linhas em `anuncios_externos_itens` (trava em `particao=0`, a única que a saga UP
  escreve hoje). No caso UP, elegibilidade/opt-in rodam por item (não por variação indexada) e o
  espelho `variacoes_externas` é pulado (o estado já vive granular em `anuncios_externos_itens.
  catalog_*`); o alerta de no-match é mantido, com as cores derivadas via join item→sku→`variacoes`.
  **Item plano (ADR-0021 rev. 2026-08-06):** a rota Legacy também cobre o item sem `variations[]`
  (ADR-0084) — `indexarElegibilidadeAnuncio` lê o status da raiz e indexa pelo item id, e
  `montarBodyOptinVariacao` faz o opt-in sem `variation_id`. Antes disso todo item plano ficava
  `pendente` para sempre.

### Remoção / reprocessamento
- **remover-publicado** — remove todas as linhas publicadas de um mesmo `codigo_pai` (global
  por org+codigo_pai), limpa storage e `anuncios_externos`; bloqueia se há UPDATE em voo.
  **E6 (ADR-0061):** aceita `canal` (default `'mercado_livre'`) — remove só da linha
  `(org_id, canal, codigo_pai)` especificada, sem afetar o produto em outros canais.
  **Modo republicar (`preservar_familia: true`, "Corrigir e republicar", 2026-07-28):** pausa os
  itens no ML, preserva família/variações/imagens, zera só os vínculos de publicação
  (`ml_item_id`, `ml_variation_id`, `preco_publicado_ml`, `anuncios_externos`) e devolve o lote
  para `revisao` — a próxima publicação vira CREATE. **Pausa da raiz Legacy (2026-08-17):** em
  família sem filhos UP a saga não roda, então o modo republicar pausa o PRÓPRIO `ml_item_id`
  (GET decide: `active` → PUT pausar; pausado/closed/moderado → segue sem PUT; 404/410 → item já
  sumiu, seguro; erro transiente aborta fail-closed ANTES de qualquer mutação local). Antes disso
  o anúncio Legacy ficava ativo e órfão no ML e a republicação criava duplicado. Esse caminho
  agora exige conexão ML viva (a remoção de Legacy/UP-esvaziada continua sem token).
  **Guarda completa de remoção UP (ADR-0088, 2026-07-23):** mini-saga própria
  (`_shared/user-products/remover-composicao.ts`) pausa TODOS os filhos com `item_externo_id`
  (mesmo os já `retirado=true` — nunca confia nesse campo como "seguro pular", crash real na janela
  entre ativar remoto e persistir local pode deixar um item genuinamente ativo) e só deleta local
  depois de confirmar por `GET`; TRY-ALL sobrevive a exceção por filho (`404`/`410` = item já sumiu
  no ML, seguro seguir). Qualquer `anuncios_externos` da família com `mudando_composicao=true`
  bloqueia a remoção inteira (`remocao_pendente`, HTTP 409 com a lista de SKUs pendentes) — a mesma
  flag cobre as janelas de crash da composição e da criação. Re-checagem do bloqueio roda de novo
  imediatamente antes de qualquer ação destrutiva (fecha, sem eliminar, a corrida entre o check
  inicial e o delete). Todas as queries agora falham alto em erro (antes, várias liam `{error}` e
  seguiam como se tivesse dado certo).
- **excluir-lote** — exclui o lote; preserva publicados (ADR-0019); bloqueia se processando/publicando.
  **Guard anti-órfão (2026-08-13):** `publicado_em` sozinho não basta — o UPDATE pode ter criado a
  cor no ML e **não** marcar a família como publicada (guard de `update-familia-ml`: cor nova sem
  `seller_custom_field` devolvido). Apagar a última família que representa aquele
  `ml_variation_id` deixava a variação viva no anúncio sem nenhuma linha no banco: vendia e não
  baixava estoque (incidente da cor Azul da linha Xik, 2 unidades). `particionarExclusao` agora
  também preserva a família não publicada cujo vínculo `ml_item_id|ml_variation_id` não sobrevive
  em nenhuma outra família da org (`vinculosVivosFora`, lido por `lerVinculosVivosFora`).
  Reposição em revisão continua excluível: os vínculos que ela herda seguem vivos na família de
  origem. Consulta indisponível → **fail-closed** (preserva), porque preservar demais é
  reversível e a órfã só reaparece numa venda perdida.
- **Varredura de movimentos órfãos (ADR-0097, 2026-08-01)** — as **duas** funções acima chamam
  `limpar_movimentos_orfaos(org)` depois do delete das famílias commitar: `estoque_movimentos` não
  tem FK para `variacoes`, então o cascade não alcança o ledger e a exclusão deixava movimento de
  produto inexistente. Best-effort (falha só loga — a exclusão já commitou e a RPC é idempotente).
  A RPC preserva 4 motivos que nascem órfãos por construção (ADR-0097 D-1.1), incluindo o
  tombstone `cancelamento_sem_baixa` — guarda do D-19, não histórico.
  `remover-publicado` é a única porta onde a varredura pode levar **histórico de venda** junto:
  consequência aceita e registrada no ADR. O modo republicar (`preservar_familia`) não varre — o
  SKU continua vivo. `excluir-lote` devolve `movimentos_removidos` no JSON.
- **reprocessar-familia** — reseta `erro→pendente` e re-enfileira (guard idempotente, ADR-0030).
- **retentar-catalogo** *(HTTP, JWT manual — ADR-0021, 2026-08-14)* — re-enfileira
  `vincular-catalogo` (delay 60s) para família `publicado` com variação Legacy ou item UP em
  `erro`/`nao_elegivel` sem `catalog_listing_id`. Não altera estado no banco.
- **reconciliar-user-products** *(HTTP, admin — ADR-0088, 2026-07-23)* — backfill: importa pro
  modelo User Products itens planos já existentes no ML publicados antes do ADR-0088
  (ADR-0084/0087), que hoje não têm linha em `anuncios_externos_itens`. 2 RPCs
  (`reconciliar_backfill_up_candidatas`/`..._upsert`, `security definer`, sem acesso a
  `anon`/`authenticated`): a 1ª lista candidatas server-side (última família por `codigo_pai`,
  `not exists` join contra `anuncios_externos`/`_itens` — sem paginação, sem risco de truncar);
  a 2ª faz o upsert de raiz+filho num único statement (evita corrida entre 2 execuções). Driver
  puro (`reconciliar-backfill.ts`) pula (nunca adivinha) candidata com GET falho, `variations`
  reais (é Legacy, não item plano), campos essenciais ausentes (`family_name`/sku/`user_product_id`)
  ou `seller_id` divergente do dono da conexão (posse); normaliza `status` estritamente pra
  `ativo`/`pausado`/`null` — nunca defaulta status desconhecido pra ativo.
- **invalidar-cache-cor** — limpa o cache Redis de cor de um código (após refazer a foto).

### Estoque (ADR-0094, Bloco A — EM PRODUÇÃO 2026-07-29)
- **sincronizar-estoque** *(worker, fila serial `estoque-{orgId}`)* — push **absoluto** (nunca
  delta) do estoque canônico (variações da família mais recente do produto) para todos os anúncios
  publicados do produto, exceto o `canal_origem` do job (a venda naquele canal já se decrementou
  sozinha). `resolverAlvosPush` (`_shared/estoque/alvos.ts`) resolve qual item externo recebe qual
  SKU nas três formas de publicação: variações num item, split em N partições (ADR-0048) e N itens
  planos user products (ADR-0088). Token por canal via `fabricarTokenPadrao` (hoje só ML; Shopee
  entra no E5). Falha de um canal nunca afeta outro (try/catch por alvo); exceção inesperada é
  tratada como retentável — devolve 500 para o QStash re-tentar (push absoluto é idempotente).
  **Reativação ao repor (ADR-0111):** com `reativar` no job e saldo > 0 no alvo, depois do push OK
  o worker lê o status ao vivo e devolve o anúncio de `pausado` para `ativo`. Lê antes de escrever
  (o job é reentregue): já ativo não recebe PUT. `moderado`/`encerrado`/`inativo`/`indisponivel`
  são intocados. Erro retentável na reativação entra na mesma lista do 500; definitivo é logado
  (`estoque_reativar_definitivo`) e o push segue como sucesso — o saldo já chegou.
  Quem liga a flag: `entrada-estoque` (direto) e o outbox, por **sinal da quantidade**
  (`lerPushPendente` marca `reposicao` quando `quantidade > 0`, então entrada e estorno entram e
  venda/ajuste não). O agrupamento de `despacharPushPendente` inclui `reposicao` na chave — sem
  isso a entrada seria despachada com a intenção da venda.
- **reconciliar-estoque** *(schedule QStash)* — rede de segurança do **push**, não do webhook
  (D-12): só re-empurra produtos que **têm movimento no ledger** (outbox pendente, drenado pelo
  mesmo `despacharPushPendente` do `sync-venda`, ou movimento nas últimas 24h já despachado mas cujo
  push falhou em definitivo no canal). **Nunca** re-empurra produto sem movimento — um webhook de
  venda perdido significa que o saldo local está **alto demais**, e reempurrar restauraria unidades
  já vendidas. Paginado (`paginarTudo`, teto de 5 páginas × 200 por org por execução). Schedule
  criado em produção: **`30 12 * * *`**, 3 retries, body `{}`
  (`scd_5WETvRdUHQr7pzKqgv4Pg4QrFNgA`). O re-push do passo 2 vai **sem** `reativar` de propósito:
  ele alcança produto com movimento recente, e reativar ali traria de volta um anúncio pausado à
  mão sem ninguém ter reposto nada (ADR-0111).

### Estoque (ADR-0094, Bloco B — módulo pago `estoque`, EM PRODUÇÃO 2026-07-29)

As duas são chamadas pelo **app** com o JWT do usuário (não pelo QStash), então `verify_jwt = true`
— declarado explicitamente no `config.toml` ao lado dos workers, para a intenção ficar registrada.
Ambas resolvem a identidade com `requireUserOrg(req, { access: 'write' })` e recusam org sem o
módulo com **403** via `exigirModulo` (`_shared/produto/modulo.ts`), que **fecha por padrão**:
falha ao ler `organizations` não libera.

- **cadastrar-produto** — cadastro manual de produto (D-1/D-1.1; código automático, ADR-0096).
  Grava um **lote normal** com `origem='manual'`, reusando o lote manual ABERTO da org, e cai na
  **mesma Revisão de sempre** — `process-familia`, `publish-familia-ml`, split e user products
  não mudam uma linha. Validação pura em `_shared/produto/validar.ts` (`validarProdutoNovo` /
  `montarLinhasProduto`), com trava **LOUD de `origem`**: `familias.origem` é `NOT NULL DEFAULT
  'nacional'`, então omitir o campo gravaria imposto errado em silêncio (ADR-0055) — a edge
  responde 400 em vez de assumir.
  **Código gerado pelo sistema (ADR-0096), não mais pelo operador.** O payload não carrega mais
  `codigoPai` nem `codigo` por variação; passa a exigir `chaveCadastro` (uuid, validado com trava
  LOUD em `validarProdutoNovo` — ausência ou formato inválido é 400). A edge reserva a faixa
  numérica via RPC `proximo_codigo_produto(org, 1 + N variações)` e deriva PAI + SKUs com
  `derivarCodigos` (`_shared/produto/codigos.ts`), oito dígitos com zeros à esquerda
  (`00000001`), o PAI sendo o menor número da faixa (D-1/D-2 do ADR-0096). Faixa que ultrapassa
  `99999999` falha LOUD (D-5), sem truncar.
  Reenvio com a mesma `chaveCadastro` (D-9 do ADR-0096) tem três desfechos possíveis, só dois
  deles são guard de 409 — o primeiro é o retorno feliz da idempotência: (1) **200, idempotente**
  — cadastro já gravado e igual ao enviado devolve o resultado original, sem criar nada; (2)
  **409, cadastro em andamento, SEM `familiaId`** — a família com aquela `chaveCadastro` existe
  mas ainda não tem variações gravadas (janela entre os dois inserts) ou está em corrida com
  outra submissão da mesma chave; resposta é "tente novamente", sem `familiaId` porque não há o
  que abrir ainda; (3) **409, cadastro gravado diverge do enviado, COM `familiaId`/`loteId`** —
  o formulário mudou entre tentativas com a mesma chave (`variacoesDivergem`, `processar.ts`); a
  família É verificável e completa, então a resposta carrega `familiaId`/`loteId` para a tela
  oferecer "abrir na Revisão" em vez de mandar "tentar de novo" (que geraria loop). O mesmo 409
  cobre o **estoque inicial alterado no reenvio** (`estoqueInicialDiverge`): a contrapartida dele
  não é `variacoes.estoque` (que nasce 0), e sim o ledger — a edge lê `estoque_movimentos` pelas
  referências `cadastro:{familiaId}:{codigo}` e compara `quantidade` com o `estoqueInicial`
  enviado. Sem movimento = retry legítimo (aplica); quantidade diferente (inclusive campo zerado)
  = 409, porque `registrar_entrada` faria no-op silencioso pela unique da referência e a tela
  mostraria sucesso com o número errado. Falha ao ler o ledger é **500**, nunca "nada aplicado". Os guards de
  duplicata sobre os códigos GERADOS
  cruzam as duas tabelas (`familias.codigo_pai` **e** `variacoes.codigo`, D-6 do ADR-0096); se
  colidirem, a edge ressincroniza a sequência com o maior código existente e tenta reservar
  de novo — colidindo ainda assim, é 500 de erro de sistema, nunca instrução ao operador
  (D-4.1/D-10 do ADR-0096, porque o operador não escolheu nenhum código para "renomear").
  Ordem que **não pode mudar**: o lote reusado só é marcado `processando` **depois** do insert da
  família; antes disso existe janela para `talvezFinalizarLote` fechar o lote e a família nascer
  dentro de um lote fechado. Estoque inicial entra por `registrar_entrada` (caminho único, D-15)
  com referência `cadastro:{familiaId}:{codigo}`, o que torna o retry no-op.
  **Sem transação de propósito** (tabela + RPC `security definer` + QStash são três caminhos, e o
  supabase-js não expõe transação multi-statement): o desenho compensa com idempotência. Estado
  parcial volta explícito no corpo (`filaOk`, `falhasEstoque`) — a tela nunca reporta sucesso limpo
  com pendência.
- **entrada-estoque** — entrada de mercadoria. Chama `registrar_entrada` e enfileira o push
  absoluto para **todos** os canais (`canal_origem: null`). `ref` de idempotência é
  **obrigatória** (o cliente gera um uuid por submissão): sem ela, duplo clique soma o saldo 2× e
  sobrescreve o custo 2×, e isso é caminho financeiro. O enfileiramento do push roda **também** no
  caminho duplicado — se a 1ª tentativa aplicou a entrada e morreu antes de enfileirar, o retry
  cairia em `duplicada` e o push nunca aconteceria; push absoluto é idempotente, então
  re-enfileirar é mais barato que perder a propagação. `pushOk: false` **não** é erro de entrada:
  o saldo já é verdade e a reconciliação diária recupera o push.
- **ajustar-estoque** (ADR-0110) — reduz ou zera saldo. **Admin-only** (`requireUserOrg` devolve
  `isAdmin`; paridade com pausar/reativar, ADR-0060) e restrita ao módulo `estoque`. Body é uma
  **lista**: `{ ajustes: [{codigo, novoSaldo}], observacao?, ref }` — 1 item ajusta uma variação,
  N itens zeram o produto inteiro. **`ref` por item** (`ajuste:{ref}:{codigo}`, montada em
  `validar.ts`): o índice de idempotência é `(org_id, referencia_externa)`, então uma `ref`
  compartilhada faria o 2º item colidir e voltar como "duplicada" — o "Zerar tudo" aplicaria só a
  primeira cor e devolveria sucesso. Pelo mesmo motivo, **SKU repetido na lista é 400**, nunca
  dedupe silencioso. Resultado vem **por item** (`{codigo, estoque, duplicada, erro?}`): um item
  que falha não impede os seguintes, e a tela mostra o que não entrou. O push (`canal_origem:
  null`) sai **uma vez por `codigo_pai`** e **sempre** — inclusive quando tudo veio duplicado ou
  com delta 0, mesmo contrato da entrada. **Só reduz**: aumento é recusado pela RPC apontando para
  a Entrada, que exige custo (ADR-0055).
- **excluir-produto** (ADR-0113) — apaga produto do Estoque. **Admin-only** e restrita ao módulo
  `estoque`, como o ajuste. Body `{ codigo_pai }` — a exclusão é por código, não por família: o
  delete leva **todas** as famílias daquele `codigo_pai` na org (ciclos de UPDATE deixam várias, e
  deixar irmãs vivas faria o produto reaparecer na lista). **Recusa com 409 se qualquer uma delas
  tiver `ml_item_id`**: apagar família publicada cortaria o vínculo de UPDATE do `ingest-lote` e a
  próxima planilha viraria anúncio duplicado (ADR-0019) — publicado sai por `remover-publicado`.
  Também 409 com família em `publicando`/`processando`, e com linha em `anuncios_externos` que
  tenha `item_externo_id`, `status='publicado'` ou `status in ('pendente','publicando')`: na janela
  `criacao_incerta` (ADR-0088) o POST já saiu para o ML sem o id ter voltado, então `ml_item_id is
  null` não prova "nunca foi ao ar". `status='erro'` **sem** `item_externo_id` segue deletável — de
  propósito: recusar por linha nua tornaria um publish que falhou indeletável pelas duas portas. Apaga as fotos do Storage sob o prefixo do
  **dono** de cada família (mesmo guard de posse de `remover-publicado`), e roda
  `limparMovimentosOrfaos` **depois** do delete (ADR-0097 D-2). Nunca toca o ML.

### Faturamento
- **sync-venda** — antes de qualquer escrita, recusa pedido cujo `seller.id` não seja a conta
  conectada (`ehVendaDaConta`, ADR-0117): o webhook `orders_v2` notifica também pedidos em que a
  conta é COMPRADORA, e sem a guarda cada compra da empresa virava linha de venda (23 na base,
  R$ 8.810,50 em `paid`). Responde 200 `{ignorado:'compra-da-conta'}` — 4xx/5xx faria o QStash
  re-tentar para sempre.
- **ml-webhook** — receiver público do ML: ACK rápido (<500ms), dedup em `ml_webhook_eventos`,
  roteia para `sync-venda` (orders/shipments), `sync-pergunta` (questions), `sync-devolucao`
  (claims) ou `sync-mensagem` (messages). Nunca confia no corpo — o worker re-busca autenticado
  (ADR-0037). Para `messages`, extrai o `pack_id` do resource (`/messages/packs/{pack}/...`),
  não o último segmento (que é o seller) — ADR-0067. O resource de `messages` é o mesmo para toda
  mensagem da conversa (dedup por conversa, não por mensagem): `sync-mensagem` apaga a linha de
  dedup ao terminar de processar, reabrindo para o próximo evento; se a conversa travar (linha
  antiga e nunca processada, >2min — job perdido), o webhook reenfileira mesmo em conflito de
  dedup (`deveReenfileirarMensagens`, plan 035).
  **Transições de estado em `questions`/`claims` (2026-08-06):** o resource desses tópicos também é
  estável por recurso (`/questions/{id}` na criação **e** na resposta; `/claims/{id}` em
  `opened → in_mediation → closed`), então o dedup por `(topic, resource)` descartava a 2ª
  notificação — pergunta respondida direto no ML continuava "Pendente" no app até a próxima
  reconciliação (`:00` do `reconciliar-faturamento` / `:30` do `backfill-faturamento`). Agora
  `classificarDedupWebhook` devolve `enfileirar` para esses dois tópicos mesmo em conflito 23505
  (worker idempotente; o throttle de 200/janela cobre flood forjado; o alerta não duplica porque
  `novaNaoRespondida` exige pergunta desconhecida). `orders_v2`/`shipments` seguem ignorando o
  duplicado — resource por evento e backstop de 72h.
- **sync-venda / sync-pergunta / sync-devolucao** *(workers)* — buscam o recurso no ML e fazem
  upsert em `ml_vendas`/`ml_perguntas`/`ml_devolucoes`; alertam Telegram. **Comprador da pergunta
  (2026-08-06):** a API v4 devolve `from: { id }` **sem `nickname`** (tanto em `/questions/{id}`
  quanto em `/questions/search`; o campo `from` some por completo se o token não for o do vendedor
  dono). `upsertPergunta` recebe o token e resolve o nome via `GET /users/{id}`
  (`buscarNickname`, cache por invocação); `preservarComprador` é a rede defensiva para um payload
  sem `from` não apagar o comprador já gravado. O ML devolve o apelido anonimizado (`OLCA4176283`),
  não o nome civil — pergunta não tem pedido associado. `sync-venda` também
  envia mensagem automática ao comprador na primeira transição para `paid` (ML Messages API).
  **Baixa de estoque (ADR-0094, Bloco A):** sempre que `pedido.status === 'paid'` (nunca o gancho
  one-shot `novaPaga` — a idempotência vem do ledger, então o retry do QStash retoma uma baixa que
  falhou no meio), chama `registrarBaixaVenda` (`_shared/estoque/baixa.ts`), que roda a RPC
  `baixar_estoque` por SKU e despacha o outbox de push pendente (`despacharPushPendente`) — nunca o
  que só esta execução aplicou, para reencontrar um push perdido de execuções anteriores.   Notifica categoria `vendas` em falha de RPC (nunca some em silêncio, é caminho financeiro).
  **Alertas de baixa parcial vs desync (2026-08-14):** `classificarBaixaSemSaldo` distingue três
  desfechos — `ok` (aplicada ≥ pedida, inclusive última unidade), `parcial` (havia saldo >0 mas
  insuficiente) e `desync` (`estoque_anterior === 0`, ML vendeu com PubliAI já zerado). Parcial
  alerta por pedido (`estoque_sem_saldo`); desync dedupe por SKU/dia
  (`estoque_desync_ml:{codigo}:{YYYY-MM-DD}`, America/Sao_Paulo) com mensagem explícita de desync. Cancelamento **antes do despacho** (`pedido.status === 'cancelled'` com
  shipment em estado pré-despacho conhecido, ou sem envio) chama `estornarVendaCancelada` (RPC
  `estornar_estoque`, D-7) e despacha o outbox de reposição para **todos** os canais (inclusive o
  ML, que não repõe sozinho); despacho **desconhecido ou já ocorrido** apenas notifica categoria
  `pos_venda` (não repõe). Desde **ADR-0121** essa decisão vive em
  `_shared/estoque/cancelamento.ts` (`tratarPedidoCancelado`, fiação real em `cancelamento-deps.ts`)
  e é chamada também pelo `reconciliar-faturamento` — o ML nem sempre reenvia webhook no
  cancelamento (medido em 18/08/2026: dois pedidos com um único webhook, o da compra), e sem o
  segundo gatilho o ramo inteiro nunca executava: zero linhas `pos_venda` na org contra 888 em
  `vendas`. Envio `cancelled` continua **avisando e não repondo** (pode ser cancelamento por
  mediação pós-despacho). O aviso exige `houveBaixaDeVenda` — sem movimento `venda` daquele
  pedido não há saldo a conferir; sem esse corte a primeira varredura alertou 26 cancelamentos
  históricos de uma vez (18/08/2026). Redeploy: `sync-venda` **v72**, `reconciliar-faturamento`
  **v68**. **Devolução (`sync-devolucao`, claims) não é tocada por este épico: nem
  repõe estoque, nem notifica** — repor exige saber o que voltou e em que estado, decisão do
  operador, fora de escopo (ADR-0094). Toda a lógica de baixa/estorno é envolvida em try/catch — a
  venda é sagrada, nenhuma falha de estoque derruba o `sync-venda`. Redeploy: **v50**.
  **Venda sem SKU resolvido (2026-08-11):** item de venda paga sem `codigo` era descartado por
  `selecionarBaixas` em silêncio — 12 unidades venderam na org DSA sem baixar e sem deixar rastro.
  Agora `registrarBaixaVenda` grava um movimento `venda_sku_nao_encontrado` (`quantidade = 0`,
  `codigo_pai` vazio para nunca entrar no outbox de push, referência
  `venda_sem_sku:{canal}:{pedido}:{item}`) e o `sync-venda` notifica a categoria `vendas`. Um
  saldo que não desce é indistinguível de um produto que não vendeu; o movimento informativo é a
  diferença.
  **Venda de SKU fora do catálogo (2026-08-13):** o caso irmão — o item TEM `codigo` (veio do
  `seller_custom_field` do pedido) mas ele não existe em `variacoes`, então a RPC devolve
  `aplicado: false, motivo: 'sku_nao_encontrado'` e o laço de `registrarBaixaVenda` seguia calado:
  o alerta acima só cobre item **sem** código. Agora esses SKUs voltam em
  `ResultadoBaixaVenda.skuDesconhecido` e o `sync-venda` alerta em `vendas`
  (`reservarNotificacao('estoque_sku_desconhecido', pedido)`). Origem típica: a variação foi
  apagada do PubliAI enquanto seguia viva no anúncio (ver o guard anti-órfão de `excluir-lote`).
  Liveness da integração (ADR-0069): erro no token ou no fetch do recurso é classificado via
  `classificarErroML` — 401/403 (`permanente-auth`) grava `marketplace_connections.auth_alerta_em`
  e alerta `notificarCategoria(..., 'integracao', ...)` só na 1ª falha (200, sem retry); 404
  mantém `naoEncontrado`/`naoEncontrada` (200); qualquer outro erro é `transiente` (502, QStash
  re-tenta). Sucesso grava `ultima_sincronizacao_ok_em` e reseta `auth_alerta_em`
  (`registrarSyncOk`/`registrarFalhaAuth` em `_shared/ml/liveness.ts`). As mensagens de venda/
  pergunta/devolução embutem a URL específica no ML (pedido, caixa de perguntas ou reclamação)
  como última linha do texto — o sino in-app (`notificacoes-bell.tsx`) já faz `linkify()` de qualquer URL
  crua no texto, então não precisou de coluna estruturada nem mudança de frontend. O refresh de token
  (`POST /oauth/token`, ADR-0012) também é coberto: o ML responde **400** (não 401) quando o
  `refresh_token` foi revogado/expirado; `postToken` (`_shared/ml/token.ts`) faz parse best-effort
  do corpo de erro e extrai o campo OAuth2 `error` (RFC 6749 §5.2), e `classificarErroML` trata
  `oauthError === 'invalid_grant'` como `permanente-auth` mesmo com status 400 — sem generalizar
  para qualquer 400 (outros erros OAuth2, incl. o 400 auto-induzido pela corrida de refresh
  concorrente do ADR-0012, continuam `transiente`).
- **sync-mensagem** *(worker)* — busca o pack de mensagens pós-venda
  (`GET /messages/packs/{pack}/sellers/{seller}?tag=post_sale`), upsert idempotente por
  `message_id` em `ml_mensagens` (contagem de "novas recebidas" via retorno do próprio upsert
  `ignoreDuplicates`, sem race entre execuções concorrentes — plan 037), alerta via
  `notificarCategoria(..., 'mensagens', ...)` — categoria por destinatário (ADR-0068), não mais o
  chat único da org. Ao terminar, apaga a linha de dedup do pack em `ml_webhook_eventos`
  (reabre para a próxima mensagem da mesma conversa — plan 035).
- **responder-pergunta** — envia resposta do operador ao ML (≤2000 chars) e atualiza o registro.
- **responder-mensagem** — envia mensagem pós-venda ao comprador (≤350 chars, limite do ML),
  re-busca o pack e marca as recebidas como lidas. Reusa `sugerir-resposta-pergunta` para a
  sugestão de IA (ADR-0067). `pack_id` validado (`/^\d+$/`) antes de entrar na query `.or()`
  de `resolverMetaPack` (plan 037).
- **sugerir-resposta-pergunta** — IA sugere resposta (não envia ao ML). Usada por Perguntas e Mensagens.
- **backfill-faturamento** — sincroniza um período retroativo. Dois modos: usuário logado (JWT)
  ou todos os usuários (QStash). Não busca shipment (frete fica nulo). Otimizado em lotes concorrentes (batching de 5) e executa Perguntas e Devoluções no início para evitar timeouts (504/546). Passo 4 (ADR-0067): após as vendas, varre os packs conhecidos (`ml_vendas`) e puxa as mensagens pós-venda de cada um (1 GET/pack, sem alerta).
  ⚠️ **Não tem a guarda de orçamento que o `reconciliar-faturamento` ganhou em 31/07** — por isso
  ainda é o worker de faturamento que estoura. Medido no schedule (`dias:7`, todas as orgs, só
  ciclos sem retry): mediana **70s em 27/07 → 81s em 03/08**, ~+1,6s/dia, com **5 falhas** no
  período — 4 timeouts (546 em 30/07, 31/07 e 02/08; 504 em 30/07) e um 520 em 02/08 — todas
  salvas pelo retry do QStash. (Ciclos de 233–253s nos eventos são tentativa + retry somados, não
  uma execução única: o teto de ~150s continua valendo por execução.) O crescimento **não vem de
  `dias`**: os Passos 1 e 2 (`buscarPerguntasSeller`, `buscarClaimsSeller`) releem o histórico
  **inteiro** do vendedor a cada execução — sem filtro de data, teto de 2000 registros cada, mais
  1 GET de return por claim. Uma pergunta respondida ou um claim fechado há meses continua sendo
  relido para sempre; o custo sobe a cada devolução nova e nunca desce. O Passo 4 **não** é o
  ofensor: `listarPacksDeVendas` tem `limite = 200`, então é caro porém constante.
  Consequência prática:
  encolher a janela (30→7 no schedule em 27/07, e no botão "Sincronizar" em 03/08 após um 546) só
  compra tempo. Correção de raiz pendente: portar `ORCAMENTO_MS` + retomabilidade do
  `reconciliar-faturamento`.
  Nota sobre o caminho manual: o botão é **single-org** (`scopedOrgId` pelo JWT) e as medições
  acima são do schedule, que percorre todas as conexões — o 546 do botão em 30 dias (02/08) é
  consistente com os 129s medidos em 27/07 mais esse crescimento, mas não há cronometragem direta
  do caminho manual.
- **reconciliar-faturamento** *(schedule)* — **Data de liberação do MP (ADR-0123, 18/08/2026):** o
  Passo 2 realinha `ml_vendas.money_release_date` de TODAS as vendas da org (não só as 72h) com o
  mapa de pagamentos que `carregarLiquidoMP` já carregou — `mapaLiberacaoPorOrder` (puro, indexa
  por `payment.order.id` e fica com a liberação mais recente) + `reconciliarLiberacoes` (io.ts).
  Custo de rede zero. Motivo: o MP **antecipa** a liberação quando a entrega é confirmada e o ML
  **não** emite webhook de pedido, então a venda sai da janela de 72h com a estimativa original
  (~D+30) congelada e o Detalhe do líquido conta como "a liberar" dinheiro que já caiu na conta
  (medido na org AVIL: 222/1157 vendas divergentes, R$ 3.136,21). Nunca grava `null` por cima de
  dado bom (só escreve quando o mapa tem data; leitura do MP falha → passo não roda). Venda cuja
  data corrigida cai em dia já passado e nunca notificada recebe `liberacao_notificada_em` daquele
  dia — a notificação diária só olha o dia corrente, e marcar evita que o backlog dispare de uma
  vez se a janela do Telegram mudar. Resposta ganhou `liberacoesCorrigidas`. Redeploy: **v69**.
  Rede de segurança: re-sincroniza as últimas ~72h
  de todos os usuários com credencial (cobre webhooks perdidos) e re-sincroniza o estorno/líquido via Mercado Pago das vendas associadas a devoluções/claims (resolvendo `order_id` por `shipping_id` se o claim for de `shipment`), sem limite de janela — `buscarClaimsSeller` varre TODOS os
  claims opened+closed do vendedor (a **varredura no ML** segue completa; o que passou a ser
  filtrado é o reprocesso no banco — ver "Filtro de reprocesso" abaixo). Liveness (ADR-0069): só o catch
  do token classifica (`registrarFalhaAuth`/alerta 'integracao' em 401/403); os catches internos
  de pedidos/perguntas/claims (`buscarPedidosPeriodo` etc.) continuam "segue" sem classificar —
  não é backstop de auth-liveness para esses casos, só para falha no token em si.
  **Duas passadas (2026-07-31, ver histórico abaixo):** Passo 1 roda perguntas+devoluções (+
  resync de estorno via MP por pedido associado) de TODAS as orgs primeiro, em lotes de 5
  (`chunk`+`Promise.all`, mesmo padrão do `backfill-faturamento`); Passo 2 roda vendas (72h) por
  último. Guarda de orçamento (`ORCAMENTO_MS=120_000`, sob o limite de 150s da edge function):
  antes de cada org em cada passo, se o tempo restante cair abaixo do piso, pula o resto e devolve
  200 com `pulou: string[]` (nunca mais 546/504 — e nunca mais deixa QStash gastar 3 retries por
  hora numa chamada fadada a estourar). `pedidosReconciliadosIds` (otimização que evitava
  re-buscar um pedido já coberto pela janela de vendas) foi removida: como devoluções agora rodam
  antes de vendas, não dá pra saber se o pedido será coberto — o custo extra é irrelevante (limitado
  ao nº de devoluções, tipicamente poucas).
  **Filtro de reprocesso (2026-08-18, corte de egress):** a varredura re-upsertava TODA pergunta e
  TODO claim a cada hora, mesmo sem mudança — medido em 17/08: 87 das 88 perguntas `ANSWERED` e
  imutáveis, 67 dos 88 claims fechados há mais de 7 dias, ~19 mil requisições PostgREST/dia para
  regravar dado idêntico. Agora carrega o estado local em lote (`carregarPerguntasLocais`,
  `carregarDevolucoesLocais` — em blocos de 200 ids, porque `in.()` vai na URL e a resposta tem
  teto de 1000 linhas) e só processa o que os predicados puros de
  `_shared/faturamento/reconciliar-filtros.ts` marcarem. Pergunta: processa se nova, se
  status/resposta/título mudaram, ou enquanto faltar `comprador_nick` resolvível (título **nulo**
  não conta — `buscarTituloItem` devolve null em erro e o upsert apagaria o título bom). Claim:
  processa se novo, aberto, se `status`/`stage` divergirem do gravado, enquanto
  `return_status_money` não estiver em estado final, ou dentro de `GRACA_CLAIM_DIAS = 7` do
  fechamento — a graça existe porque `return_status_money` vem de `GET /returns` e muda de forma
  **invisível** no payload do claim. O predicado vive no chamador periódico, **não** dentro de
  `upsertPergunta`/`upsertDevolucao`: essas funções também servem o caminho de webhook
  (`sync-pergunta`, `sync-devolucao`), que dispara justamente porque algo mudou. Efeito colateral
  bom: `upsertDevolucao` parou de bater `ml_vendas.atualizado_em` de hora em hora nas vendas com
  devolução, o que fazia o delta-poll do frontend (ADR-0082) devolver linhas em todo tick.
  **Memo de catálogo:** os passos 1 e 2 carregavam o MESMO catálogo da org duas vezes por execução
  (cada carga pagina `familias` + `variacoes` + `anuncios_externos_itens` inteiras — 6 páginas em
  08/2026). `memoCatalogo(admin)` (`_shared/faturamento/io.ts`) guarda a Promise por `userId` com
  escopo de **invocação**; cache de módulo serviria catálogo velho enquanto o isolate estiver quente.

### Monitoramento / alertas
- **monitorar-moderados** — varre publicados, detecta moderação nova/resolvida, alerta Telegram
  (ADR-0035). Runbook: [../runbooks/monitorar-moderados.md](../runbooks/monitorar-moderados.md).
- **notificar-liberacao** — alerta quando uma venda é liberada no saldo MP; idempotente por dia BRT (ADR-0040).

### Pulse (ADR-0119)
- **pulse-coletar** — coletor server-side do radar de concorrência, dual-mode (mesmo padrão de
  `monitorar-moderados`): QStash (schedule) roda sem escopo de org — todas as conexões ML, tier do
  `body`; usuário logado (botão "Atualizar agora") escopa só a própria org, sempre tier `completo`,
  teto de 50 produtos **por org** na execução. Tier `completo` (schedule diário 06h BRT, teto 200
  produtos por org na execução) roda `sincronizarRadar` (espelha `anuncios_externos` publicados em
  `pulse_produtos`, arquiva os que saíram), coleta ofertas de todos os produtos ativos, snapshot de
  vendedores (1×/dia, se `transactions_total` **ou** a `uf` mudou — a UF vem de `address.state` da
  mesma resposta de `/users/{id}`, sem chamada nova) e a referência de preço do ML dos produtos
  com `origem='auto'` **e** `codigo_pai` preenchido; tier `quente` (a cada 6h, teto 100 por org na
  execução) só reconsulta ofertas dos produtos `origem='auto'`, sem vendedores/referência. A mesma
  resposta de `/products/{id}/items` (`limit=100` explícito; excedente vai para o log) alimenta
  `pulse_produtos.meu_preco` — a nossa oferta na ficha, o preço vivo que a coluna "Seu preço" mostra
  (Errata 4 do ADR-0119). `sincronizarRadar` monta o radar pelo `catalog_product_id` do JSON
  `variacoes_externas` e, **só para os códigos publicados sem nenhum cpid ali**, cai em
  `variacoes` da família mais recente com `catalog_status='vinculado'` — sem esse resgate, anúncio
  publicado e vinculado ficava inteiro fora do radar (Errata 5). Passo em lote à parte lê a
  situação do anúncio (`/items?ids=…`, 20 por chamada) para `anuncio_status` e consulta
  `/sites/MLB/listing_prices` para a estrutura da comissão. Essa consulta usa o preço **efetivo**
  (`meu_preco`, colhido no passo de ofertas desta mesma execução) sempre que ele existe para o
  **mesmo** `item_id`, e só cai no `price` do multiget — que é o preço base, sem promoção — quando
  não existe; o preço usado fica gravado em `comissao_preco` (Errata 7 do ADR-0119). Grava em
  `pulse_ofertas` via upsert `produto_id,item_id,dia` — merge, **sem** `ignoreDuplicates`, para uma
  2ª execução no mesmo dia sobrescrever a linha de hoje com o valor atual em vez de travar no 1º
  valor visto e reemitir alerta a cada rodada. A notificação traz **os novos desta execução e o
  total ainda não lido** — sem o segundo número a conta nunca fecha com o painel, que mostra o
  acumulado pendente (três execuções de 5, 3 e 1 viram "9 alertas novos" na tela).
  Alertas em `pulse_alertas` + 1 notificação agregada por org por execução na categoria `pulse` —
  **somente para org com `pulse` em `modulos_habilitados`**. A coleta roda para todas as orgs (o
  histórico acumula desde o dia 1), mas a mensagem diz "abra o menu Pulse" e uma org sem o módulo
  não tem esse menu: os operadores da Avil chegaram a receber alertas de um menu que não podiam
  abrir (2026-08-18). Os alertas continuam gravados e aparecem no painel quando o módulo for ligado.
  **Passo 7 — visitas 30d (ADR-0120), só no baseline** (`baseline = !scopedOrgId && tier ===
  'completo'`: a varredura agendada da madrugada, nunca o botão manual nem o tier `quente` — senão
  cada clique dispararia a varredura inteira por um número que não se move a cada 6h). Mede as
  visitas dos últimos 30 dias de cada oferta viva (`pulse_ofertas_atual`) via
  `/items/{id}/visits/time_window?last=30&unit=day` — única medida de demanda de anúncio de
  terceiro que a API expõe (Errata 9 do ADR-0119). Fila ordenada por menos-medido-primeiro
  (`visitas_30d` null vai na frente), teto de tempo próprio de 30s (o passo mais longo da execução;
  o que não couber fica para o baseline seguinte). Leitura que falha (403/429/timeout) não escreve
  nada — preserva a medida do dia anterior em vez de apagá-la com `null`. Grava em
  `pulse_ofertas.visitas_30d` (migration `20260818012222_pulse_ofertas_visitas_30d.sql`).
- **pulse-adicionar** — adiciona manualmente um produto ao radar por link de catálogo
  (`/p/MLBxxxx`) ou GTIN (busca em `/products/search`); item avulso de anúncio de terceiro é
  impossível de coletar pela API (403 sempre — ver errata do ADR-0119) e a função recusa essa
  entrada com mensagem explícita. Ficha inexistente devolve 404 em vez de criar linha morta no
  radar. Insere em `pulse_produtos` (`org_id,catalog_product_id`) com `origem='manual'`,
  `status='ativo'` **apenas quando a ficha ainda não está no radar**: se já estiver, reaproveita a
  linha existente e devolve `ja_existia: true` sem tocar em `origem` nem em `status`. O upsert
  incondicional anterior rebaixava produto `auto` para `manual` (tirando-o do tier quente e
  congelando a referência de preço) e desfazia o pausar do operador. Única exceção: ficha
  **arquivada** volta para `ativo`, porque readicioná-la é um pedido explícito de trazê-la de volta.
- **pulse-sonar** (ADR-0120, `verify_jwt=true`, chamada pelo app com o JWT do usuário) — garimpo
  on-demand por termo livre (`{termo}`, mínimo 3 caracteres): busca `/products/search` (site MLB,
  até 40 fichas — dobrado de 20 porque o topo do resultado vem cheio de ficha sem vendedor ativo, e
  ficha vazia é barata: curto-circuita antes de categoria/visitas/vendedores), e por ficha, em
  lotes de 5 (`Promise.allSettled` — falha em uma ficha não derruba a busca, entra como resultado
  vazio) lê `/products/{id}/items` (ofertas — **sem** excluir a própria org: no garimpo a nossa
  oferta também é mercado). **Ficha sem oferta ativa** (404 "No winners found" ou `results: []`
  mesmo com 200) devolve resultado vazio direto — não é enriquecida com categoria/visitas/
  vendedores. Ficha com oferta resolve `category_id` pelo preditor nativo do ML
  (`buscarCategoriaPreditor`, já cacheado 30d em `_shared/ml/domain-discovery.ts`, casando pelo
  nome da ficha — `/products/{id}` não devolve `category_id`; chamada sob `comTimeout` de 10s
  porque a função é compartilhada com o fluxo de publish, que não pode ganhar timeout lá — sem
  isso um fetch interno travado derrubaria a ficha inteira), visitas de 30 dias só do item MAIS
  BARATO da ficha (`/items/{id}/visits/time_window`; multiget não serve, teto de 1 id por
  chamada) e `/users/{seller_id}` por vendedor distinto (UF via `ufDoVendedor`, `transactions.total`),
  com cache de vendedor por request (`Map`, sellers repetem entre fichas). `montarPainelSonar`
  (`_shared/pulse/sonar.ts`) agrega tudo em `PainelSonar` — soma de visitas por dia entre fichas
  com datas desalinhadas, `visitas_30d` nulo nunca vira zero na soma, % frete grátis ponderado
  por ofertas, vendedores distintos e `palavras_chave`. Resultado cacheado no Redis por
  `sonar:v2:MLB:<termo normalizado>`, TTL 24h, chave **global** (sem `org_id` — dado público,
  ADR-0120 §3) — bump de v1→v2 pela mudança de shape nas fichas sem vendedor ativo, para um
  resultado v1 já cacheado não servir o shape antigo por até 24h; falha do ML na busca principal
  (`null`) devolve 502 e não cacheia, para não travar um termo vazio por 24h a partir de um erro
  transitório.
- **pulse-sonar-vendas** (ADR-0122, `verify_jwt=true`, chamada pelo app com o JWT do usuário) —
  vendas estimadas do nicho via Apify, complemento do Sonar chamado pelo front **em paralelo** à
  `pulse-sonar` (edge separada de propósito: o run da Apify pode levar minutos e a falha dele
  degrada só o bloco de vendas). Recebe `{termo}` (mínimo 3 caracteres, mesma normalização);
  sem `APIFY_TOKEN` configurado devolve `{configurado:false}` com 200 (indisponível ≠ erro).
  Roda o actor `karamelo/mercadolivre-scraper-brasil-portugues` de forma síncrona
  (`run-sync-get-dataset-items`, `timeout=120s`, `{keyword, maxPages:1}`, ordem de relevância;
  cliente em `_shared/apify/client.ts`) com **`maxTotalChargeUsd=0.10` ≈ 20 anúncios** — o actor é
  PAY_PER_EVENT a US$ 0,005 por anúncio e sem custo fixo de run, então o teto controla o gasto e a
  quantidade ao mesmo tempo; atingir o teto devolve o run como SUCCEEDED com o que coube, não como
  falha (ADR-0122 §3). Agrega em `montarPainelVendas`
  (`_shared/pulse/sonar-vendas.ts`): `vendas_totais` (Σ do "+N vendidos" da página — acumulado e
  arredondado, piso; anúncio sem o dado NUNCA soma como zero), `valor_mercado` (Σ preço ×
  vendidos onde ambos existem), `produto_destaque` (mais vendido) e `palavras_chave_titulos`
  (títulos de anúncios reais, não nomes de ficha). Cache Redis `sonar:vendas:v2:MLB:<termo>`,
  **TTL 7 dias**, chave global (dado público, ADR-0120 §3) — o dado é acumulado histórico em
  faixas arredondadas, então TTL curto só repagava o mesmo número; falha/timeout do run devolve
  502 e não cacheia.

### Status / métricas / viabilidade
- **status-publicados** — lê status de todos os anúncios (ML + extras) via conector multicanal
  (resiliente a "sem credencial"). **E6 (ADR-0061):** agrupa `familias.ml_item_id` + `anuncios_externos`
  por canal, lê em lote por canal. Escopo e token da **operação** (todos os anúncios da org),
  não do chamador (ADR-0056).
- **atualizar-status-publicado** — pausa/reativa um anúncio (`{ml_item_id, status, canal?}`)
  via `ChannelConnector.atualizarStatus` (PUT parcial `status`). Gate `requireAdmin` (não só
  `requireUser`) — primeira ação de escrita restrita a admin do projeto (ADR-0060). **E6 (ADR-0061):**
  canal opcional (default `'mercado_livre'`). Token da operação, mesmo padrão do `status-publicados`.
- **metricas-vendas** — agrega vendas do período por anúncio gerenciado (mapa GTIN→item).
  Mesmo escopo de operação e credencial ML compartilhada do `status-publicados` (ADR-0056).
- **analisar-viabilidade** — concorrência + comissões + margem antes de cadastrar (ADR-0014/0015);
  o menor preço da concorrência usa o valor vigente de venda de cada publicação
  (`GET /items/{item_id}/sale_price?context=channel_marketplace`), e não o campo legado `price`
  de `/products/{product_id}/items`; falha nessa consulta preserva `price` como fallback. O cache
  Redis dessa leitura usa a versão **`gtin:v4:*`** (TTL 6h), separada dos valores legados; a chave
  é montada **só** por `chaveCacheGtin()` (`_shared/concorrencia/cache-chave.ts`) — o literal já
  apareceu em 3 call sites e um bump parcial deixaria leitura e escrita em versões diferentes.
  Todo bump invalida a concorrência de todas as orgs (sem perda de dado; a primeira análise
  seguinte remonta o cache).
  margem/"Vale a pena" item-a-item descontam a alíquota de imposto por origem (ADR-0055). Frete do
  vendedor (`buscarFreteVendedor`) usa a dimensão vinda do caller (planilha) quando válida; senão
  busca em `variacoes` por `org_id`+`gtin` (produto já cadastrado antes); sem nenhuma das duas, cai
  no pacote genérico do `frete.ts` e devolve `dimensoesEncontradas: false` para o front oferecer
  input manual (modo "Colar GTINs" reenvia só esse GTIN com `dimensoes` preenchidas). Resposta
  também traz `me2Habilitado` (lido de `marketplace_connections.me2_habilitado`) — quando `false`,
  o front avisa que o frete de todos os itens saiu 0 por falta de adesão ao Mercado Envios, não
  porque o frete real é zero.
  **Botão "Cadastrar" (spike 037, 2026-08-08):** cada item traz `descricaoCatalogo`
  (`short_description.content` de `GET /products/{id}` — payload que a função já buscava e
  descartava, zero rede nova) e `jaCadastrado` (existe variação com esse GTIN na org). O select de
  `variacoes` virou **incondicional** no ramo `existeNoML`: é o mesmo round-trip, mas se
  continuasse condicional o recálculo de frete com dimensões informadas apagaria o sinal.
  `jaCadastrado` é **heurística de UX** por GTIN — o guard autoritativo de duplicata continua
  sendo o 409 de `cadastrar-produto` por `codigo_pai` (ADR-0094 D-4). **Dimensões não vêm da
  ficha de catálogo** — medido no spike: os atributos do produto são de especificação
  (`BRAND`, `SALE_FORMAT`, `UNITS_PER_PACK`…), e peso/medidas são `SELLER_PACKAGE_*`, atributo
  do anúncio de cada vendedor.
- **calcular-tarifa-ml** — comissões (classic + premium) por preço/categoria + frete que o vendedor absorve (frete grátis ao comprador, via `GET /users/{id}/shipping_options/free`); `recebe = preço − comissão − frete − imposto` (imposto por origem somado ao cálculo client, ADR-0055). Body aceita `dimensoes` (peso/medidas da variação representativa); cache Redis 6h (chave inclui dimensões + vendedor).

### Acesso / usuários

- **usuarios** — gestão de usuários por **admin**, escopada à organização do chamador (ADR-0047 +
  ADR-0027). `verify_jwt=true`; valida que o chamador é admin ativo com `org_id`
  (`requireUser` + `profiles`) e usa `service_role`. Ações: `invite` (`auth.admin.inviteUserByEmail`
  com `nome`/`allowed_menus`/**`org_id`** — herda a org do admin — no metadata + `redirectTo` para
  `/#/definir-senha`), `update_menus`, `set_active`, `set_admin`, `update_notificacoes` (destino
  Telegram do usuário: `telegram_chat_id` + `telegram_categorias`, sanitizado por
  `sanitizarDestinatario`, ADR-0068) — as quatro escopadas `.eq('org_id', orgId)`, só atuam em
  perfis da própria org. `set_active`/`set_admin` bloqueiam (403) um admin comum alterando um
  perfil com `is_super_admin=true` da mesma org (plan 037). Ações de **super-admin** (D-E7.8,
  `profiles.is_super_admin`): **`list_orgs`** (lista organizações + contagem de membros) e
  **`create_org`** (cria a organização e convida seu primeiro admin; rollback da org se o convite
  falhar). **`set_canais_org`** (spec 2026-07-14 "menus multicanal"): grava
  `organizations.canais_habilitados` da org alvo, filtrando contra a mesma lista de ids do registry
  `src/lib/canais.ts` (duplicada aqui de propósito, comentário de sincronia no código) e travando
  `mercado_livre` sempre habilitado e deduplicando o array (`[...new Set(canais)]` pós-allowlist);
  `list_orgs` passou a devolver `canais_habilitados` de cada org. Requer o secret `APP_URL`.
  **Menu `canais`** entrou em `MENU_KEYS` (tela `/canais`, ex-OAuth de Configurações) — mudança em
  `MENU_KEYS`/`_shared/` exige redeploy da `usuarios` via CLI completa (conferir versão pós-deploy).
  **Em produção desde 2026-07-15** (migration `20260715014055_menus_multicanal` + esta edge
  redeployadas; ver histórico de `verify_jwt` abaixo).
- **suporte** — fluxo de autorização temporária do ADR-0092. Super-admin solicita acesso com
  motivo e escopo; admin ativo do tenant aprova, rejeita ou revoga. No `start`, a função chama
  `start_support_session(request.id, user.id, now)` em vez de atualizar a solicitação diretamente:
  a RPC faz a validação e, para renovação, encerra a sessão anterior, abre a nova por duas horas e
  grava as auditorias como uma transação. Erro ou retorno vazio da RPC é `409`; notificações aos
  admins só ocorrem após o início confirmado. A própria function não duplica `session_started`.

### Utilitário
- **hello** — smoke test de deploy.

---

## Padrões transversais

- **Identidade por organização (ADR-0027, E7):** funções autenticadas resolvem `requireUserOrg(req)`
  → `{userId, orgId, isAdmin}` em vez de só `userId`. O token do canal vem de
  `resolverConexao(admin, orgId, 'mercado_livre')` (`_shared/canais/conexao.ts`) +
  `getValidAccessTokenConexao(conexao)` (`_shared/ml/token.ts`) — **não existe mais**
  `getValidAccessToken(userId)` nem leitura de `ml_credentials` no código (tabela congelada, ver
  [modelo-de-dados.md](modelo-de-dados.md)). Webhooks e jobs sem chamador HTTP (sync/reconciliar)
  resolvem a org via `resolverIdentidade`/`resolverOrgPorUserId` (`_shared/faturamento/io.ts`),
  que buscam em `marketplace_connections`.
- **Modelo de IA por organização (ADR-0074):** as 5 funções que chamam IA-texto —
  `process-familia`, `definir-categoria-familia`, `regenerar-copy-familia`,
  `sugerir-resposta-pergunta`, `publicar-split-ml` (via `titulo-particao.ts`) — resolvem
  `resolverModeloTexto(admin, orgId)` uma vez por request e passam o resultado a
  `gerarCopy`/`desempatarAtributosLLM`/`desempatarCategoriaLLM`/`sugerirResposta`/
  `gerarTituloParticao` (parâmetro `modelo`, default `MODELO_COPY`) em vez de cada uma reler a
  constante de módulo. `sugerir-resposta-pergunta` trocou `requireUser` por `requireUserOrg` só
  para ganhar `orgId` (deixa de ser a única função autenticada sem escopo de org). Modelo de
  imagem (`ai_model_imagem`) gravado mas ainda sem consumidor — nenhuma função lê essa coluna.
- **Idempotência (regra inegociável):** claims atômicos (`UPDATE … WHERE status=…`), upserts,
  reuso de `picture_id`/IDs já gravados, guards de status. Workers podem ser reexecutados pelo
  retry do QStash sem duplicar efeito.
- **Fila serial de publicação:** `garantirFilaSerial(userId)` → `parallelism=1` por usuário (ADR-0034).
- **Dedup de webhook:** `(topic, resource)` único em `ml_webhook_eventos`.
- **Secrets principais:** `SUPABASE_*`, `QSTASH_TOKEN`/`QSTASH_*_SIGNING_KEY`, `ML_CLIENT_ID`/
  `ML_CLIENT_SECRET`/`ML_REDIRECT_URI`, `OPENROUTER_API_KEY` (+`AI_MODEL_*`),
  `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `PUBLIAI_PUBLIC_URL`. Lista em `.env.example`.

---

## Histórico — `reconciliar-faturamento` sem schedule QStash desde a criação (corrigida)

Achado 2026-07-24 (investigando o schedule do reconciliador de convergência do ADR-0088): a
`reconciliar-faturamento` foi criada em 2026-06-22 (ADR-0037) com a intenção explícita de rodar
"QStash schedule 1h" — mas **nenhum schedule apontando pra ela existia de fato** na conta QStash
(confirmado via `GET /v2/schedules`: só `backfill-faturamento`, `monitorar-moderados` e
`notificar-liberacao`). A função exige `verificarAssinatura` (HMAC do QStash) e não tem nenhuma
outra via de disparo (não é JWT/admin, não está no `render.yaml`) — ou seja, a rede de segurança
contra webhooks perdidos de vendas/perguntas/devoluções **nunca rodou automaticamente** desde que
foi construída (~1 mês). `verify_jwt=false` estava correto (ver histórico abaixo) — não era esse o
problema, era a ausência literal do schedule. Corrigido: schedule `0 * * * *` (1h, conforme
ADR-0037) criado em produção (`scd_7HR22qXe5kx4LogfYb2GStCDGcTD`).

## Histórico — `reconciliar-faturamento` estourava 150s em TODA execução + estorno total nunca capturado (corrigida)

Achado 2026-07-31 (Diego reportou devoluções do ML "sempre" divergindo do Dashboard, precisando
de revisão manual recorrente): dois bugs independentes, ambos de dados silenciosamente incompletos
(sem erro visível na UI).

**1) `reconciliar-faturamento` nunca completava desde que o schedule foi criado (24/07).**
Confirmado via `GET /v2/events` do QStash: 94 dos ~747 eventos em `ERROR`, TODOS aos ~150s
(`WORKER_RESOURCE_LIMIT` HTTP 546 ou `IDLE_TIMEOUT` HTTP 504) — ou seja, toda hora, sem exceção,
desde a criação. A função rodava Vendas (o item mais caro, 72h de pedidos com frete+shipment
sequenciais) → Perguntas → Devoluções, para 2 orgs no mesmo loop sequencial: o orçamento de 150s
da edge function estourava antes de alcançar Devoluções (por último) — exatamente o sintoma já
corrigido em `backfill-faturamento` em 26/07 (504/546 "de hora em hora", corrigido reordenando +
paralelizando), mas o fix nunca foi replicado aqui. Resultado: a rede de segurança contra webhooks
perdidos nunca rodava de fato. Fix: duas passadas (devoluções+perguntas de TODAS as orgs antes de
vendas) + lotes de 5 (`chunk`) + guarda de orçamento (120s, retorna 200 com `pulou` em vez de
estourar). Verificado ao vivo: 2 execuções via QStash publish direto, ambas `DELIVERED`/200 em
~65s.

**2) Estorno TOTAL nunca era gravado, em nenhuma execução — não era timing.**
`carregarLiquidoMPDoPedido` (`_shared/faturamento/enriquecimento.ts`) filtrava pagamentos do MP
com `status === 'approved'`, pensado para descartar pagamento recusado (`rejected`) de sobrescrever
dado bom. Mas no estorno TOTAL o Mercado Pago move o `status` do pagamento de `approved` para
`refunded` (só no PARCIAL ele mantém `approved` com `transaction_amount_refunded > 0`) — o filtro
excluía esse pagamento para sempre, em qualquer reconciliação futura. Usado por 3 callers:
`sync-devolucao`, `sync-venda` e `reconciliar-faturamento` — o real-time também nunca capturava.
Provado ao vivo: pedido 2000017347779820 (devolução "Tecido Oxford", R$59,99) tinha
`ml_vendas.estorno = null` mesmo com o claim já `refunded` em `ml_devolucoes`; o pagamento MP
168125592416 tinha `status: "refunded"`. Fix: aceitar `status === 'approved' || status === 'refunded'`.
Teste adicionado em `enriquecimento.test.ts`. Redeploy: `sync-devolucao`, `sync-venda`,
`reconciliar-faturamento`. Verificado ao vivo: `estorno` do pedido virou `59.99` na execução
seguinte do reconciliador.

O Dashboard usa `ml_vendas.estorno > 0` para contar devoluções (não `ml_devolucoes`, que "tem
lacunas de sincronização" por design — comentário em `src/pages/Dashboard.tsx`) — os dois bugs
juntos explicam "2 devoluções · R$48,26" no Dashboard vs 3 devoluções (R$108,25) no painel do ML.

**3) `buscarPagamentosMP` (varredura em lote) tinha o MESMO filtro `status=approved` — na query
de busca do MP, não só no client.** Menu Financeiro (`src/pages/Financeiro.tsx`) lê de
`useResumoVendas`/`ml_vendas` (ADR-0038/0093 — o caminho MP "ao vivo" separado virou código morto),
mesma fonte única do Dashboard: não havia razão pra manter esse filtro restrito a `approved`. Fix:
mesmo padrão de `buscarClaimsSeller` — 2 buscas (`approved` + `refunded`), merge dos resultados.
Fecha a lacuna pra pedidos SEM claim associado (cancelamento com estorno direto no MP, sem
`ml_devolucoes`): confirmado por SQL — 4 pedidos com pagamento `refunded` e `estorno` nulo/zero
sem claim (R$66,12 total: R$24,99+R$13,68+R$12,80+R$14,65).

**Limitação conhecida (não corrigida agora):** esses 4 pedidos são de 30/06–22/07 — mais antigos
que a janela de 72h do `reconciliar-faturamento` e os 7 dias do schedule de
`backfill-faturamento` (`dias:7`), e sem claim então o Passo 1 (devoluções) também não os alcança.
Tentativa de backfill manual com janela ampla (`desde/ate` cobrindo 30/06–23/07) estourou os
mesmos 150s (`backfill-faturamento` não tem a guarda de orçamento que `reconciliar-faturamento`
ganhou nesta correção) — abortado sem insistir, pra não repetir o problema que acabou de ser
corrigido. Esses 4 pedidos específicos ficam órfãos até um backfill manual mais estreito (1 org por
vez, ou `backfill-faturamento` ganhar a mesma guarda de orçamento). Novos casos do mesmo tipo
(estorno sem claim) a partir de agora são cobertos normalmente pelas janelas de rotina, já com o
filtro `refunded` incluído.

## Histórico — divergência de `verify_jwt` no faturamento (corrigida)

Entre 2026-06-26 e 2026-06-28, `ml-webhook`, `sync-venda`, `backfill-faturamento` e
`reconciliar-faturamento` estavam com `verify_jwt=true` no `config.toml` mas são acionadas por
QStash/webhook (sem JWT Supabase) — o gateway rejeitava com 401 antes da função rodar,
derrubando o faturamento em tempo real em cascata. Corrigido pelo
[ADR-0046](../decisions/0046-verify-jwt-false-workers-webhook-faturamento.md)
(`verify_jwt=false` nas quatro, autenticação real continua interna por assinatura/JWT). Confirmado
em produção que segue `false`. Detalhe do incidente em
`obsidian-vault/05-Bugs/Incidentes.md`.

## Histórico — `verify_jwt=false` acidental na `usuarios` (corrigido no mesmo deploy)

2026-07-15, deploy da migration/edge de "menus multicanal": o 1º `supabase functions deploy
usuarios` rodou com `--no-verify-jwt` (flag copiada por hábito de outro deploy da mesma sessão),
sobrescrevendo o `verify_jwt=true` do `config.toml` — a `usuarios` autentica o chamador via
`requireUser` e é admin-only, então isso teria destrancado o endpoint no gateway (a checagem
interna do código continuaria rodando, mas sem a barreira do Supabase antes dela). Pego antes de
qualquer uso real conferindo `config.toml` logo após o deploy; redeploy imediato sem a flag,
confirmado com `curl` sem `Authorization` → `401`. Caso inverso do incidente acima: aqui a flag
foi adicionada onde NÃO deveria. Lição: `verify_jwt` é por função no `config.toml` — nunca reusar
a flag de linha de comando de um deploy anterior sem reconferir a função específica.

## Congelamento do custo na venda (ADR-0109)

`upsertVenda` (`_shared/faturamento/io.ts`), depois de gravar os itens, congela o custo do produto
em `venda_item_custo` — `ignoreDuplicates` (ON CONFLICT DO NOTHING), então o primeiro sync grava e
os seguintes não tocam no valor. Erro ao congelar **lança**: é caminho financeiro, não pode ficar
em silêncio.

O congelamento mora dentro do `upsertVenda`, e não nos callers, porque `ml_vendas_itens` tem um
writer só mas **quatro** chamadores: `sync-venda`, `sync-devolucao`, `backfill-faturamento` (que é
quem *descobre* vendas novas no schedule horário) e `reconciliar-faturamento` (dois call sites).
`opts.custoVigenteResolver` é **obrigatório** — quem esquecer não compila (`deno check` do CI).

O resolver sai de `carregarCatalogo`, que passou a ler `custo, atualizado_em` de `variacoes` e
monta os mapas de `_shared/faturamento/custo-vigente.ts` — espelho servidor de `src/lib/custos.ts`
(cadeia variação → anúncio → GTIN → código, tie-break na linha mais recente, ADR-0108). As duas
cópias são amarradas por `tests/lib/paridade-custo-fe-be.test.ts`.

**Redeploy ao mexer em `io.ts`/`custo-vigente.ts`** — as 7 functions que importam **este arquivo**
(não só as 4 que chamam `upsertVenda`): `sync-venda`, `sync-devolucao`, `backfill-faturamento`,
`reconciliar-faturamento`, `ml-webhook`, `sync-pergunta`, `sync-mensagem`. `responder-mensagem` e
`responder-pergunta` importam **outros** módulos da pasta (`mensagens-io.ts`, `perguntas-io.ts`) —
mexeu neles, redeploy dessas duas também. `usuarios` não importa nada de `_shared/faturamento/`.

## Anúncio de catálogo no catálogo do faturamento (ADR-0021)

Vincular um produto ao catálogo do ML cria um anúncio **separado**, com MLB próprio
(`variacoes.catalog_listing_id`), que não é o `familias.ml_item_id`. A venda dele chega com
`item.id` = MLB de catálogo e sem `variation_id`.

`carregarCatalogo` registra esse MLB em `idsPubliai`/`codPorItem`/`eanPorItem` (`set` direto: o
vínculo é 1:1 com a variação, sem a ambiguidade de "primeira variação da família" que obriga o
guard nas chaves da família). Antes, a venda de catálogo era reconhecida só pelo **fallback de
GTIN** (`venda.ts` §2): produto sem EAN cadastrado ficava sem código — e sem código não há baixa de
estoque. Hoje nenhum SKU vinculado está sem GTIN (288 na Avil, 4 na DSA, conferido em 2026-08-11),
então a mudança é robustez, não correção de dado existente.

Não afeta `is_publiai` no caso comum: o fallback de GTIN já promovia. Só passa a promover o caso
sem EAN, e corretamente — o anúncio de catálogo é nosso, criado pelo `vincular-catalogo`.

Vale só para syncs **futuros**: linhas de `ml_vendas` já gravadas mantêm o código persistido até
serem re-sincronizadas.

## Histórico — filho User Products herdava código/EAN de outra cor (corrigida)

`fundirItensUP` (`_shared/faturamento/catalogo-up.ts`) não sobrescrevia uma entrada já existente em
`codPorItem`/`eanPorItem`. Quando o `item_externo_id` do filho UP é **também** o
`familias.ml_item_id` (a cor 1 de uma família migrada para o modelo User Products, ADR-0088 — 8 dos
53 filhos em produção), `carregarCatalogo` já havia semeado a chave: com a **primeira variação da
família em ordem arbitrária** (`io.ts:96-98`) ou com `familias.codigo_pai` (`io.ts:103`, que é o
agrupador e não o produto vendido). Resultado: a venda gravava código/EAN de outra cor — 4 vendas
com código errado, 3 delas também com EAN errado. Exemplo: `MLB4959919693` (Amarelo Canário,
sku `26705421`) gravava o código `18760903`, que é do Vermelho.

Corrigido invertendo a regra: o par `item_externo_id → sku` é 1:1 exato (ADR-0088 "Ancoragem") e
**sobrescreve** qualquer valor derivado da família. Anúncio com variações reais não é afetado — a
venda traz `variation_id` e o resolver acha por `codPorVar` antes de consultar o mapa por item.
`infoPorGtin` segue first-wins: a chave é o próprio GTIN, então uma entrada existente já é do mesmo
produto.

**Custo e markup não foram afetados:** `venda_item_custo` (ADR-0109) é chaveado por
`(venda_id, ml_item_id, variation_id)`, não por código, e é insert-once — verificado em produção,
o custo congelado das 15 vendas de filho UP já estava correto (cores da mesma família compartilham
custo). O erro era só de rastreabilidade.

Redeploy: `sync-venda` (v61), `reconciliar-faturamento` (v61), `backfill-faturamento` (v64),
`sync-devolucao` (v41) — todas importam `carregarCatalogo`.

**Como as 4 linhas históricas foram corrigidas (e o tropeço no caminho):** o `backfill-faturamento`
exige JWT de sessão, indisponível na sessão do agente, então as linhas foram atualizadas por
`UPDATE` derivado de `anuncios_externos_itens.sku` — a mesma fonte que o código deployado usa. A
query de apoio, porém, escolhia a variação com `order by atualizado_em desc limit 1`, e o código
`26705421` existe em **duas famílias** com GTINs diferentes (`4753000051` e `4753000053`) e
`atualizado_em` **idêntico** — o desempate caiu na família errada e gravou o GTIN errado em 3 das 4
linhas. O sync seguinte (14:01) regravou o valor correto sozinho, justamente por causa do fix acima.
Conferido depois com a chave certa (variação da **família do anúncio vendido**): 0 código errado,
0 EAN errado, 0 divergência em `venda_item_custo`.

Lição para quem for repetir: código de variação **não** é chave única entre famílias (ADR-0108).
Desempatar por `atualizado_em` não funciona quando o re-ingest grava o mesmo instante nas duplicatas
— resolva sempre pela família do anúncio vendido. Detalhe em `obsidian-vault/09-Logs/Changelog.md`
(2026-08-11) e em `obsidian-vault/05-Bugs/Problemas Resolvidos.md`.

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
