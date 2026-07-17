# Referência — Modelo de dados

> **Tipo:** Reference (Diátaxis). Schema Postgres do PubliAI. Fonte: `supabase/migrations/`
> (DDL canônico — ADR-0043) e `src/lib/database.types.ts` (tipos gerados). Termos em
> [glossario.md](glossario.md). O "porquê" de cada decisão está nos ADRs citados.

## Regras transversais

- **RLS por organização** (ADR-0027, E7): as 12 tabelas de domínio + storage liberam
  leitura/escrita ao membro cuja `org_id` bate com `org_id = (select public.current_org_id())`.
  `public.is_membro_operacao()` (ADR-0047) foi **dropada** — era o gancho intermediário da fase de
  operação compartilhada. `user_id`/`criado_por` permanece como auditoria de quem criou a linha,
  não mais como escopo de isolamento.
- **`org_id_default()`** (trigger `BEFORE INSERT`) preenche `org_id` a partir de
  `current_org_id()` quando o INSERT não o informa — cobre os INSERTs autenticados do frontend.
  Workers `service_role` (sem `auth.uid()`) **precisam setar `org_id` explicitamente**; o `NOT NULL`
  falha alto se algum caminho esquecer.
- **`atualizado_em`** mantido por trigger `moddatetime` na maioria das tabelas.
- **Escritas sensíveis** (credenciais, faturamento) são bloqueadas para `authenticated` e só
  ocorrem via `service_role` (workers) ou RPC `security definer`.
- **Tokens** nunca em colunas de texto — ficam no **Vault** (`vault.secrets`).

## Organizações e multi-tenancy (ADR-0027, E7)

### `organizations`
O tenant. Hoje 1 linha (**Avil** — `slug='avil'`), dona de todos os dados atuais (backfill do E7).
*Migration `20260705163656_e7_organizations.sql`.*

`id`, `nome`, `slug` (único), `marca_padrao` (resolve o hard-code `'Avil'` de `atributos.ts`),
`lote_seq` (contador da numeração de lote por org — ver `lotes.numero_org`), `criado_em`,
`atualizado_em`. RLS: SELECT do membro da própria org; UPDATE só admin da própria org; criação
só via `service_role` (edge `usuarios`, action `create_org`, restrita a super-admin).

**`canais_habilitados` text[]** (default `'{mercado_livre}'`, migration `20260715014055_menus_multicanal.sql`,
spec 2026-07-14 "menus multicanal"): quais marketplaces a org enxerga como conectáveis — D5 do
registry híbrido (registry do código decide o que **existe**/está implementado, esta coluna decide
o que a **org** pode operar). Editada só por super-admin via edge `usuarios` (action `set_canais_org`,
trava `mercado_livre` sempre habilitado). Lida pelo front via RPC `canais_habilitados_da_org()`.

### `marketplace_connections`
**Substitui `ml_credentials`** como fonte da credencial de canal — a conexão é da **organização**,
não do usuário (fecha a pendência do ADR-0047 "membros não publicam"). *Migration
`20260705171224_e7_marketplace_connections.sql`.*

`id`, `org_id` (FK organizations), `canal` (`canal_externo`), `conta_externa_id` (ml_user_id do
vendedor — não é segredo), `conta_label` (nickname), `scope`, `expires_at`,
`access_token_secret_id`/`refresh_token_secret_id` (FK→`vault.secrets`), `criado_por` (FK
auth.users), `criado_em`, `atualizado_em`. Único `(org_id, canal)`. RLS: SELECT do membro da
própria org; INSERT/UPDATE/DELETE só via RPC `service_role`. A migração de dados reusa os
**mesmos** `secret_id` da `ml_credentials` existente — zero re-criptografia.

Liveness da integração (ADR-0069, migration `20260712171338_liveness_marketplace_connections.sql`):
`ultima_sincronizacao_ok_em timestamptz` (última sync bem-sucedida de qualquer worker/reconciliação)
e `auth_alerta_em timestamptz` (marcado na 1ª falha 401/403 detectada, resetado a `null` no próximo
sucesso — anti-spam do alerta Telegram categoria `integracao`). Escritas via `registrarSyncOk`/
`registrarFalhaAuth` (`_shared/ml/liveness.ts`), só `service_role` (sem policy de UPDATE extra).

## Acesso e usuários (ADR-0047 + ADR-0027)

### `profiles`
Espelho 1:1 de `auth.users` (`id` FK). Colunas: `email`, `nome`, `is_admin`, `is_active`,
`allowed_menus text[]` (chaves de menu que um não-admin acessa), `created_at`, `updated_at`,
**`org_id`** (FK organizations, `NOT NULL` — a organização do usuário, ADR-0027), **`is_super_admin`**
(boolean, default `false` — só Diego; único papel que cria organizações via `create_org`),
`telegram_chat_id`, `telegram_categorias text[]` (destinatário Telegram por perfil, ADR-0068 —
CHECK `profiles_telegram_categorias_validas` restringe a `vendas`/`perguntas`/`pos_venda`/
`financeiro`/`moderacao`/`mensagens`/`integracao` (ADR-0069, migration
`20260712171337_integracao_categoria_notificacao.sql`); categoria sem nenhum assinante não envia nada).
Criado no signup pelo trigger `handle_new_user` (semeia `nome`/`allowed_menus`/**`org_id`** do
`raw_user_meta_data` do convite). RLS: SELECT do próprio ou de admin **da mesma org**;
INSERT/UPDATE/DELETE só admin, escopado à própria org.

**Helpers** (SECURITY DEFINER, `search_path=''`, execute só p/ `authenticated`):
- `public.is_admin()` — o chamador tem `profiles.is_admin`.
- `public.current_org_id()` — retorna a `org_id` do chamador ativo (`is_active`); **pivô da RLS
  por organização** (ADR-0027). `STABLE`, cacheado 1× por statement no initplan.
- `public.is_super_admin()` — o chamador tem `profiles.is_super_admin`.
- `public.is_membro_operacao()` — **dropada** (E7, migration `20260705165828_e7_rls_org.sql`);
  era o gancho intermediário da operação compartilhada (ADR-0047), substituído por `current_org_id()`.

## Relações de domínio

```
organizations (1) ──< profiles (N)
              │
              └────< marketplace_connections (1 por canal) ──► tokens no Vault

lotes (1) ──< familias (N) ──< variacoes (N)
                  │
                  └─ espelhado em ── anuncios_externos  [(org_id, canal, codigo_pai, particao)]

ml_credentials (1 por user, DEPRECADA) ──► tokens OAuth no Vault

ml_vendas (1 por pedido) ──< ml_vendas_itens (N) ──► match com variacoes por GTIN/EAN
ml_vendas ──► ml_devolucoes (por order_id)
ml_perguntas        (independente, respondível pelo app)
ml_moderacao        (1 linha aberta por item moderado)
ml_webhook_eventos  (dedup de webhooks; org_id NULLABLE — eventos de vendedor desconhecido)
configuracoes (1 por org)
```

Todas as 12 tabelas de domínio + `ml_webhook_eventos` têm `org_id` (FK organizations, indexado);
`NOT NULL` em todas exceto `ml_webhook_eventos` (ADR-0027).

---

## Núcleo de publicação

### `lotes`
Um upload de planilha + imagens; inicia o pipeline. *Migration `20260527123422_enums_lotes_storage.sql` (ADR-0007).*

Colunas-chave: `id`, `user_id` (FK auth.users), `org_id` (FK organizations, ADR-0027),
`numero` (sequência global, legado), **`numero_org`** (sequência **por org**, "Lote #N" exibido
pelo front — `numero_org ?? numero`; gerada por `proximo_numero_lote(org)`), único
`(org_id, numero_org)`, `status` (`lote_status`), `planilha_path`, `imagens_paths text[]`,
`total_familias` / `total_publicadas` / `total_erros` (mantidos por trigger),
`erro_mensagem`, `criado_em`, `atualizado_em`.
Índice: `(user_id, criado_em DESC)`, `(org_id)`. RLS por organização (`org_id = current_org_id()`).
Trigger `update_lote_counters` recalcula contadores e faz a transição `processando → revisao`
quando todas as famílias saem de pendente/processando (*`20260609132501_lote_transicao_revisao.sql`*).

### `familias`
Um PAI = um anúncio. Guarda identidade, resultado da IA, estado de publicação e auditoria de
edição. *Migration `20260527125643_familias_variacoes.sql` (ADR-0007/0008/0009).*

Grupos de colunas:
- **Identidade:** `lote_id` (FK→lotes, cascade), `user_id`, `org_id` (FK organizations,
  ADR-0027), `codigo_pai`, `nome_pai`, `descricao_pai`, `unidade`. Único: `(lote_id, codigo_pai)`.
- **Lifecycle:** `status` (`familia_status`), `operacao` (`operacao_ml`).
- **Categorização:** `tipo_aviamento`, `tipo_origem`, `categoria_ml_id`, `categoria_nome`.
- **Origem/imposto (ADR-0055):** `origem` (enum `origem_produto` `nacional`/`importado`,
  default `nacional`), lida da coluna opcional `ORIGEM` da planilha (linha PAI).
  *Migration `20260703113001_imposto_origem_e_aliquotas.sql`.*
- **Copy (IA):** `titulo_ml`, `descricao_ml`, `atributos_ml jsonb`, `tokens_input/output`.
- **Concorrência/mercado:** `analise_mercado jsonb`, `concorrencia_*`.
- **Preço:** `estrategia_preco`, `estrategia_motivo`, `custo_centavos` (ADR-0020/0042),
  `exibir_com_desconto`, `desconto_pct`, `preco_reancorado_lider` (bool, default false,
  migration `20260708144126`, ADR-0065 — flag família-level: o preço foi reancorado no piso
  dos MercadoLíderes por estar dando prejuízo).
- **Atacado (ADR-0041):** `atacado jsonb`, `atacado_status`, `atacado_erro`.
- **Fotos do PAI:** `capa_storage_path`/`capa_ml_picture_id` e `capa2_*`, `capa3_*`.
- **Envio (ADR-0009/0018):** `shipping_mode`, `frete_gratis`, `sale_terms jsonb`.
- **Resultado:** `ml_item_id`, `ml_permalink`, `publicado_em`.
- **Auditoria de edição:** `titulo_editado_pelo_operador`, `descricao_editada_pelo_operador`,
  `editado_em`, `observacao_operador`.
- **Processamento:** `erro_mensagem`, `qstash_message_id`, `variacao_principal_codigo` (ADR-0044).

Índices por `(user_id, codigo_pai)`, `(user_id, ml_item_id)`, `(lote_id, status)`, `(org_id)`.
RLS por organização (`org_id = current_org_id()`, ADR-0027).

### `variacoes`
Um SKU/cor = uma variação do anúncio. *Migration `20260527125643_familias_variacoes.sql`
(ADR-0003/0004/0018).*

Grupos:
- **Identidade:** `familia_id` (FK→familias, cascade), `user_id`, `org_id` (FK organizations,
  ADR-0027), `codigo`, `nome`, `gtin`. Único: `(familia_id, codigo)`.
- **Estoque/preço:** `estoque`, `estoque_anterior`, `preco`, `preco_publicacao`,
  `preco_editado_pelo_operador`, `custo`, **`preco_publicado_ml`** (numeric, nullable, ADR-0078):
  preço de venda efetivamente confirmado no ML para o SKU no último publish/update bem-sucedido;
  base do badge "preço alterado" na Revisão; `NULL` = nunca publicado.
- **Dimensões:** `peso_gramas`, `altura_cm`, `largura_cm`, `comprimento_cm`.
- **Cor (ADR-0004/0029):** `cor`, `cor_hex`, `cor_origem`, `cor_editada_pelo_operador`.
- **Foto:** `imagem_path`, `ml_picture_id`.
- **Catálogo (ADR-0021):** `catalog_product_id`, `catalog_listing_id`,
  `catalog_status` (`pendente`/`vinculado`/`sem_produto`/`family_diff`/`nao_elegivel`/`erro`),
  `catalog_erro`.
- **Resultado/exclusão:** `ml_variation_id`, `excluida_da_publicacao`.

### `anuncios_externos`
Espelho multicanal normalizado. Identidade estável independente de lote/família.
*Migrations `20260614152627_anuncios_externos.sql` (ADR-0025) + `20260705234110_e6_anuncios_externos_estado.sql` (ADR-0061).*

`id`, `user_id`, `org_id` (FK organizations, ADR-0027), `canal` (`canal_externo`), `codigo_pai`,
`item_externo_id`, `permalink`, **`status`** (`pendente|publicando|publicado|erro`, check-constraint;
E6/ADR-0061), `erro_mensagem`, `variacoes_externas jsonb` (mapa
`codigo → {variation_id, catalog_product_id, catalog_listing_id, catalog_status}`),
`metadados_canal jsonb`, `preco_override`, `publicado_em`, **`particao smallint`**, **`titulo`**,
**`qstash_message_id`** (rastreio do job do fan-out, diagnóstico/idempotência; E6/ADR-0061).
Único: **`(org_id, canal, codigo_pai, particao)`** (era `(user_id, canal, codigo_pai, particao)`
até o E7 — a identidade do anúncio passou a ser da **organização**, não do usuário, ADR-0027/0025).
Populado por dual-write dos workers + backfill. **E6 (ADR-0061) — Estado por canal:** cada linha
é uma máquina de estado independente (`pendente → publicando → publicado | erro`); claim atômico
em `(org_id, canal, codigo_pai, particao=0)` garante `pendente|erro → publicando` antes do worker
processar (idempotência em re-entrega de QStash).
*Split (ADR-0048, migration `20260629180206_anuncios_externos_particao.sql`):* um produto com
>100 cores tem N linhas (uma por anúncio/partição); cada `variacoes_externas` é a **ancoragem**
(sku → anúncio). Produto ≤100 cores tem só `particao=0` (idêntico ao modelo original ADR-0025).

---

## Credenciais

### `ml_credentials` — **deprecada (remoção pendente, Task 17)**
Tokens OAuth do ML por usuário; tokens no Vault. *Migration `20260527141015_ml_credentials_vault.sql`.*
**Substituída por `marketplace_connections` no E7** (ADR-0027, D-E7.4) — a tabela e as RPCs abaixo
ficam **congeladas** (não lidas nem escritas pelo código atual); o drop é diferido para a Task 17,
depois de ~1 semana estável em produção.

`user_id` (PK), `org_id` (adicionado no E7, `NOT NULL`, sem novo tráfego), `ml_user_id`,
`ml_nickname`, `scope`, `expires_at`, `access_token_secret_id`/`refresh_token_secret_id`
(FK→`vault.secrets`). SELECT pelo dono; INSERT/UPDATE/DELETE só via RPC `service_role`:
`upsert_ml_credentials`, `get_ml_tokens`, `delete_ml_credentials` — **idem, deprecadas**.

---

## Faturamento e pós-venda

### `ml_vendas`
Uma linha por pedido do ML (webhook + backfill + reconciliação).
*Migrations `20260622193345_faturamento_vendas.sql` + aditivos (ADR-0037/0038/0039/0045).*

Pedido: `order_id` (único com `user_id`), `pack_id`, `status`, `status_detail`,
`date_created`, `date_closed`. Comprador: `comprador_id/nick/nome`, `cidade`, `uf` (ADR-0039).
Valores: `total_amount`, `paid_amount`, `sale_fee_total`, `frete_vendedor`, `liquido`
(do MP quando há `MP_ACCESS_TOKEN`, senão estimado), `estorno`, `currency`.
Envio: `shipping_id/status/substatus/logistic`, `tracking_number`.
Financeiro: `money_release_date`, `liberacao_notificada_em` (ADR-0040),
`sacado_em`/`sacado_por` (*migration `20260702162832_ml_vendas_saque.sql`*) — marca manual de
saque no Financeiro > Detalhe do líquido, escrita só via RPCs `security definer`
`registrar_saque_ml_vendas(uuid[])` / `desfazer_saque_ml_vendas(uuid[])`
(exigem `is_membro_operacao()`; `registrar` só marca linhas com `money_release_date` já liberado).
Classificação: `is_publiai` (match GTIN/família — ADR-0045), `tem_devolucao`. `raw jsonb`.
Único `(user_id, order_id)`; índice `(user_id, date_closed DESC)`.

**`canal` text** (default `'mercado_livre'`, migration `20260715014055_menus_multicanal.sql`, **em
produção desde 2026-07-15**): dimensão canal preparatória — coluna simples (não o enum
`canal_externo`), só para permitir o filtro por canal em `buscarVendas`/`useVendas`/
`useResumoVendas` no dia em que houver um 2º canal de vendas real. Hoje **não entra no `select`**
de `buscarVendas` (follow-up deliberado, não bloqueante — ver TASKS.md); as camadas acima mapeiam
`canal: 'mercado_livre'` por fallback fixo — zero número muda.

### `ml_vendas_itens`
Itens de um pedido. *Mesma migration + `20260623104822` + `20260627095025` (unique).*
`venda_id` (FK→ml_vendas, cascade), `ml_item_id`, `variation_id`, `titulo`, `codigo`, `cor`,
`ean`, `quantity`, `unit_price`, `sale_fee`, `is_publiai`.
`sale_fee` é a tarifa do ML **por unidade**; a comissão do pedido (`ml_vendas.sale_fee_total`)
é `Σ(sale_fee × quantity)` — sem `× quantity` o líquido de pedidos com qtd>1 fica inflado.

### `ml_devolucoes`
Claims/devoluções. *Migration `20260622193401_faturamento_devolucoes.sql` (ADR-0037).*
`claim_id` (único com user), `order_id`, `stage`, `status`, `type`, `reason_id/texto`,
`valor_em_jogo`, `return_status`, `return_status_money`, `acoes_pendentes jsonb`,
`aberto_em`, `raw jsonb`.

### `ml_perguntas`
Perguntas de compradores. *Migration `20260622193354_faturamento_perguntas.sql` (ADR-0037).*
`question_id` (único com user), `item_id`, `item_titulo`, `texto`, `criada_em`,
`comprador_id`, `status` (`unanswered`/`answered`/`banned`), `resposta`, `respondida_em`,
`raw jsonb`.

### `ml_webhook_eventos`
Dedup de webhooks. *Mesma migration de vendas (ADR-0037).*
`topic`, `resource`, `recebido_em`, `processado_em`, `erro`. Único `(topic, resource)`.
Índice `(user_id, recebido_em)` para o throttle por vendedor do `ml-webhook` (janela de 60s, INT-018/033).
Para `messages`, o resource é o mesmo para toda a conversa — `sync-mensagem` **apaga** a linha ao
processar (reabre o dedup para a próxima mensagem) em vez de só marcar `processado_em`, plan 035.

### `ml_mensagens`
Mensagens pós-venda comprador↔vendedor. *Migration `20260711120000_faturamento_mensagens.sql`
(ADR-0067).* `pack_id`, `order_id`, `message_id` (**único com `user_id`**, alvo do upsert
idempotente), `direcao` (`recebida`/`enviada`), `texto`, `item_titulo`, `data_ml`, `lida`,
`atualizado_em`, `raw jsonb`. Grants: só `select` para `authenticated` (RLS por `user_id`);
`anon` sem nenhum privilégio (a migration original dava `grant all` por engano — revogado no
plan 037, mesmo precedente de `ml_perguntas`). Escrita real só pelo worker (`service_role`,
bypassa RLS).

---

## Monitoramento e configuração

### `ml_moderacao`
Anúncios moderados/pausados + coordenação de alertas. *Migration `20260622115621_ml_moderacao.sql` (ADR-0035).*
`ml_item_id`, `status`, `motivo`, `detectado_em`, `alertado_em`, `resolvido_em`.
Índice único parcial `(user_id, ml_item_id) WHERE resolvido_em IS NULL` (evita alerta duplicado).

### `configuracoes`
Settings por **organização** desde o E7 (era por usuário). *Migrations `20260606120614` +
`20260622121259` (ADR-0017/0035/0040) + `20260703113001` (ADR-0055) + `20260704120000`
(ADR-0059) + `20260705174455_e7_config_org.sql` (ADR-0027).*
`user_id` (PK, legado), `org_id` (FK organizations, `NOT NULL`, **único** — 1 configuração por
org), `desconto_pct`, `telegram_ativo`, `telegram_chat_id`, `telegram_bot_token` (sensível —
nunca retornado; lido via RPC `telegram_config_status()` que só informa `tem_token boolean`),
`aliquota_nacional_pct` (default 8), `aliquota_importado_pct` (default 16) — alíquotas por org,
sem override por família (ADR-0055) —, `desconto_concorrencia_pct` (default 5) — percentual
abaixo do menor concorrente aplicado por `sugerirPrecoVenda` (ADR-0059, antes fixo em 5%) —,
`reancora_lider_ativa` (default false, migration `20260708144126`, ADR-0065) — liga a re-âncora
do preço no menor preço entre concorrentes MercadoLíder quando o preço competitivo dá prejuízo —,
`mostrar_lucro_dashboard` (default false, migration `20260717112328_mostrar_lucro_dashboard.sql`)
— liga a exibição do lucro (`lucro R$ X`) no card "Líquido no faturamento" do Dashboard —,
**`mp_access_token_secret_id`** (FK→`vault.secrets`, ADR-0027 D-E7.7): token Mercado Pago
**por org**; lido via RPC `get_mp_token(org)`, com fallback ao `MP_ACCESS_TOKEN` de instância
quando a org não tem secret configurado (zero regressão — a Avil segue no fallback até o secret
ser semeado manualmente).
**`ai_model_texto`/`ai_model_imagem`** (text, nullable, ADR-0074, migration
`20260713120000_ai_model_por_org.sql`): slug OpenRouter do modelo de IA da org, lista curada via
CHECK constraint (texto: `openai/gpt-4o-mini` padrão ou `deepseek/deepseek-v4-flash`; imagem, hoje
dormente sem consumidor: só `google/gemini-2.5-flash-image`, "Nano Banana") — incluir um novo
modelo exige migration (altera o CHECK), não é config/env. `NULL` (caso comum,
inclusive todas as orgs em produção hoje) → `ai_model_texto` cai no fallback `MODELO_COPY`/env
`AI_MODEL_COPY` via `resolverModeloTexto` (`_shared/ai/modelos.ts`); `ai_model_imagem` sem uso
ainda — reserva o campo para a futura feature de geração de imagem. Sem RLS nova: admin-only sai
de graça da RLS já existente de `configuracoes` (insert/update admin org).

---

## Storage

Bucket **`imagens`** (privado). Paths no formato `{user_id}/{lote_id}/{arquivo}` — **não mudaram
no E7** (ADR-0027, D-E7.6). RLS: SELECT quando o dono do path (1º segmento) pertence à **minha
organização** (`profiles.org_id = current_org_id()`, join por `storage.foldername(name)[1]`);
INSERT/UPDATE/DELETE continuam "own" (`auth.uid()` == 1º segmento). *Migration `20260527123422`
+ `20260705165828_e7_rls_org.sql`.*

---

## Funções SQL (`security definer`)

| Função | Papel |
|---|---|
| `update_lote_counters()` | Trigger: recalcula contadores de `lotes` + transição de status |
| `current_org_id()` | **Pivô da RLS por org** (ADR-0027): `org_id` do chamador ativo (`is_active`) |
| `is_super_admin()` | O chamador tem `profiles.is_super_admin` |
| `org_id_default()` | Trigger `BEFORE INSERT`: preenche `org_id` do INSERT a partir de `current_org_id()` quando ausente |
| `proximo_numero_lote(org)` | Incrementa `organizations.lote_seq` e retorna o próximo `numero_org` (row-lock na org) |
| `upsert_marketplace_connection(...)` | Grava conexão de canal por org, criando/atualizando secrets no Vault |
| `get_connection_tokens(connection_id)` | Lê tokens descriptografados do Vault (só `service_role`) |
| `delete_marketplace_connection(connection_id)` | Remove conexão + secrets (idempotente) |
| `get_mp_token(org)` | Lê o secret do Mercado Pago da org no Vault; `null` se a org não configurou (caller cai no fallback de instância) |
| `canais_habilitados_da_org()` | `security definer`, `search_path=''`: retorna `organizations.canais_habilitados` da própria org (evita abrir SELECT direto em `organizations`) |
| `telegram_config_status()` | Retorna `(chat_id, ativo, tem_token)` sem expor o token |
| `marcar_mensagens_lidas(pack_id)` | Marca as mensagens recebidas de um pack como lidas (limpa o badge da conversa) |
| `contar_conversas_aguardando()` | Conta packs de `ml_mensagens` do chamador cuja última mensagem (`data_ml desc nulls last, message_id desc`) é `recebida` — badge do menu, sem baixar a tabela inteira (plan 036) |
| ~~`upsert_ml_credentials(...)`~~ | **Deprecada** (E7) — substituída por `upsert_marketplace_connection` |
| ~~`get_ml_tokens(user_id)`~~ | **Deprecada** (E7) — substituída por `get_connection_tokens` |
| ~~`delete_ml_credentials(user_id)`~~ | **Deprecada** (E7) — substituída por `delete_marketplace_connection` |
| ~~`is_membro_operacao()`~~ | **Dropada** (E7) — substituída por `current_org_id()` na RLS |

---

## O que **não** existe (YAGNI consciente)

- Sem `catalogo_interno` (cache cross-lote) — substituível por query em `familias`.
- Sem `jobs_log` — auditoria de fila vive no dashboard Upstash + `qstash_message_id`.
- Sem `organization_members`/papéis finos (m2m) — 1 organização por usuário (`profiles.org_id`),
  decisão consciente do E7 (ADR-0027, D-E7.1/D-E7.2); m2m e enum de papéis ficam para o E8 (billing).
- `canal_externo` só tem `mercado_livre` — ganha valor novo quando entrar o 2º canal.
