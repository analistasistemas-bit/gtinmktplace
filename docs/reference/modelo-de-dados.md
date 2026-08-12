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
O tenant. Hoje 2 linhas — **Avil** (`slug='avil'`, dona de todos os dados do backfill do E7) e
**DSA** (`slug='diego-souza'`). *Migration `20260705163656_e7_organizations.sql`.*

`id`, `nome`, `slug` (único), `marca_padrao` (resolve o hard-code `'Avil'` de `atributos.ts`),
`lote_seq` (contador da numeração de lote por org — ver `lotes.numero_org`), `criado_em`,
`atualizado_em`. RLS: SELECT do membro da própria org; UPDATE só admin da própria org; criação
só via `service_role` (edge `usuarios`, action `create_org`, restrita a super-admin).

**`produto_seq bigint not null default 0`** (migration `20260731192443_codigo_produto_automatico.sql`,
ADR-0096): contador do código de produto/SKU gerado no cadastro manual, mesmo padrão de
`lote_seq` — reservado só via RPC `proximo_codigo_produto()`, nunca escrito direto. Inicializado
por org com o maior código numérico de até oito dígitos já existente em `familias.codigo_pai`/
`variacoes.codigo` (comparação **numérica**, não de string — ver a RPC abaixo). A migration
seguinte (`20260731193955_codigo_produto_seq_reaplicavel.sql`) trocou a inicialização por um
ratchet (`greatest(produto_seq, …)`) para a migration ficar reaplicável sem rebobinar a
sequência. Uma terceira (`20260731194443_avil_produto_seq_faixa_reservada.sql`) deslocou só a
**Avil** para a faixa reservada `99000000` (decisão pontual desta org, ADR-0096 D-4.2) — a
**DSA** permanece em `1`.

**`canais_habilitados` text[]** (default `'{mercado_livre}'`, migration `20260715014055_menus_multicanal.sql`,
spec 2026-07-14 "menus multicanal"): quais marketplaces a org enxerga como conectáveis — D5 do
registry híbrido (registry do código decide o que **existe**/está implementado, esta coluna decide
o que a **org** pode operar). Editada só por super-admin via edge `usuarios` (action `set_canais_org`,
trava `mercado_livre` sempre habilitado). Lida pelo front via RPC `canais_habilitados_da_org()`.

**`modulos_habilitados` text[]** (default `'{}'`, migration `20260729124711_e6b_origem_lote_e_modulos.sql`,
E6b/ADR-0094 D-13): módulos **pagos** que a org contratou — hoje só `'estoque'` (cadastro manual +
entrada de mercadoria). Default vazio: habilitar é sempre ato explícito do super-admin, via edge
`usuarios` action `set_modulos_org`. Diferente de `canais_habilitados`, **não há módulo
obrigatório** — lista vazia é estado válido. Lida pelo front via RPC `modulos_habilitados_da_org()`
(`security definer`, sem parâmetro de propósito: não existe caminho para ler os módulos de outra
org; `revoke all from public`, `grant execute to authenticated`).
Esconder o menu é **navegação**, não fronteira de segurança (ADR-0047): o gate real são as edges
`cadastrar-produto` e `entrada-estoque`, que respondem 403 para org sem o módulo.

### `marketplace_connections`
**Substitui `ml_credentials`** como fonte da credencial de canal — a conexão é da **organização**,
não do usuário (fecha a pendência do ADR-0047 "membros não publicam"). *Migration
`20260705171224_e7_marketplace_connections.sql`.*

`id`, `org_id` (FK organizations), `canal` (`canal_externo`), `conta_externa_id` (ml_user_id do
vendedor — não é segredo), `conta_label` (nickname), `scope`, `expires_at`,
`access_token_secret_id`/`refresh_token_secret_id` (FK→`vault.secrets`), `criado_por` (FK
auth.users), `criado_em`, `atualizado_em`. Único `(org_id, canal)` **e**
`(canal, conta_externa_id)` parcial onde `conta_externa_id is not null`
(`20260726000240_indice_unico_conta_externa_ml.sql`, ADR-0091): a mesma conta de marketplace não
pode pertencer a duas orgs. Sem esse índice, `resolverIdentidade` (`.maybeSingle()`) erra com 2
linhas e devolve null, e o `ml-webhook` descarta o evento como "vendedor desconhecido" — os
webhooks das **duas** orgs param em silêncio. RLS: SELECT do membro da própria org;
INSERT/UPDATE/DELETE só via RPC `service_role`. A migração de dados reusa os
**mesmos** `secret_id` da `ml_credentials` existente — zero re-criptografia.

Liveness da integração (ADR-0069, migration `20260712171338_liveness_marketplace_connections.sql`):
`ultima_sincronizacao_ok_em timestamptz` (última sync bem-sucedida de qualquer worker/reconciliação)
e `auth_alerta_em timestamptz` (marcado na 1ª falha 401/403 detectada, resetado a `null` no próximo
sucesso — anti-spam do alerta Telegram categoria `integracao`). Escritas via `registrarSyncOk`/
`registrarFalhaAuth` (`_shared/ml/liveness.ts`), só `service_role` (sem policy de UPDATE extra).

`me2_habilitado boolean` (migration `20260730185835_marketplace_connections_mercadoenvios.sql`):
a conta ML aderiu ao Mercado Envios (`"me2"` em `GET /users/{id}/shipping_preferences → modes`).
Sem isso, `buscarFreteVendedor` (`_shared/ml/frete.ts`) falha silenciosamente (400 "does Not have
me2 enabled") e o frete sai como 0 na Viabilidade — achado ao vivo numa conta NEWBIE sem vendas.
**Não usar `GET /users/{id}` (`status.mercadoenvios`) para isso** — fica desatualizado por um tempo
após a adesão (confirmado: dizia `"not_accepted"` com o frete já funcionando). Populado em
`ml-oauth-claim` no momento da conexão; `null` = não checado (conexão antiga, best-effort). UI:
`useMlConnection`/`Canais.tsx` avisa o operador quando `false`.

### `configuracoes` — 1 por organização (ADR-0086)

`org_id` é a **PRIMARY KEY** (1 linha por org); trigger `seed_configuracoes_org` cria a linha default
ao inserir a org (+ backfill das existentes). `user_id` é só **auditoria da última edição** (nullable,
FK `ON DELETE SET NULL`); FK `org_id` é `ON DELETE CASCADE`. Guarda: alíquotas de imposto
(`aliquota_nacional_pct`/`aliquota_importado_pct`, default 8/16), `aliquotas_confirmadas_em` (flag do
LOUD — sem ela o `process-familia` bloqueia a publicação em vez de aplicar 8/16 em silêncio, ADR-0055
refinado; "salvar as alíquotas em Configurações = confirmar"), `desconto_pct`/`desconto_concorrencia_pct`,
`ai_model_texto`/`ai_model_imagem` (ADR-0074) e `telegram_*`.
RLS: leitura por membro da org, escrita só admin. Leituras no backend sempre por `org_id`.

## Acesso e usuários (ADR-0047 + ADR-0027)

### `profiles`
Espelho 1:1 de `auth.users` (`id` FK). Colunas: `email`, `nome`, `is_admin`, `is_active`,
`allowed_menus text[]` (chaves de menu que um não-admin acessa), `created_at`, `updated_at`,
**`org_id`** (FK organizations, nullable apenas para super-admin da plataforma), **`is_super_admin`**
(boolean, default `false` — só Diego; único papel que cria organizações via `create_org`),
`telegram_chat_id`, `telegram_categorias text[]` (destinatário Telegram por perfil, ADR-0068 —
CHECK `profiles_telegram_categorias_validas` restringe a `vendas`/`perguntas`/`pos_venda`/
`financeiro`/`moderacao`/`mensagens`/`integracao` (ADR-0069, migration
`20260712171337_integracao_categoria_notificacao.sql`); categoria sem nenhum assinante não envia nada).
Criado no signup pelo trigger `handle_new_user` (semeia `nome`/`allowed_menus`/**`org_id`** do
`raw_user_meta_data` do convite). A constraint validada `profiles_identity_xor` exige exatamente
um dos estados: super-admin com `org_id is null`, ou membro de cliente sem super-admin e com
`org_id` preenchido (ADR-0092). RLS: SELECT do próprio ou de admin **da mesma org**;
INSERT/UPDATE/DELETE só admin, escopado à própria org.

**Helpers** (SECURITY DEFINER, `search_path=''`, execute só p/ `authenticated`):
- `public.is_admin()` — o chamador tem `profiles.is_admin`.
- `public.current_org_id()` — retorna a `org_id` do chamador ativo (`is_active`); **pivô da RLS
  por organização** (ADR-0027). `STABLE`, cacheado 1× por statement no initplan.
- `public.is_super_admin()` — o chamador tem `profiles.is_super_admin`.
- `public.is_membro_operacao()` — **dropada** (E7, migration `20260705165828_e7_rls_org.sql`);
  era o gancho intermediário da operação compartilhada (ADR-0047), substituído por `current_org_id()`.

### Acesso autorizado de suporte (ADR-0092)

`support_requests` registra o ciclo de pedido, aprovação, sessão e renovação. Cada linha guarda
solicitante, organização, escopo (`read` ou `full`), motivo, estado, janelas de expiração e a
referência `renewal_of`; há no máximo uma sessão ativa por solicitante e uma pendência por
solicitante+organização. `support_audit_events` registra ator, alvo, resultado e horário, sem
payload livre; o FK composto impede associar auditoria à organização errada. Ambos usam RLS e os
admins do tenant só leem o histórico da própria organização.

`start_support_session(request_id, requester_id, now)` é uma RPC `SECURITY DEFINER`, executável
somente por `service_role`. Ela bloqueia a solicitação aprovada e, em renovação, a sessão anterior;
aceita apenas os 15 minutos finais, encerra a anterior, inicia a nova por exatamente duas horas e
grava ambas as auditorias na mesma transação. A migration
`20260726153552_finalize_support_access.sql` também agenda um único job `pg_cron`,
`cleanup-support-audit-events` (`15 3 * * *`), que chama `cleanup_support_audit_events()` e apaga
somente eventos com mais de um ano que não estejam em `legal_hold`.

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
`erro_mensagem`, `criado_em`, `atualizado_em`,
**`origem`** (`text not null default 'planilha'`, check `planilha | manual` — E6b/ADR-0094 D-2;
o default backfilla todo lote histórico como planilha, que é correto: até a migration
`20260729124711_e6b_origem_lote_e_modulos.sql`, planilha era a única origem possível).
Índice: `(user_id, criado_em DESC)`, `(org_id)`, e **`lotes_org_manual_aberto_idx`** —
parcial `(org_id, criado_em desc) where origem='manual' and status in ('importando',
'processando','revisao')`, que sustenta o reuso do lote manual ABERTO da org (D-1.1: sessão de
cadastro = um lote). O predicado espelha **exatamente** a query da edge `cadastrar-produto`;
divergir só torna o índice inútil, a query continua correta.
RLS por organização (`org_id = current_org_id()`).
Trigger `update_lote_counters` recalcula contadores e faz a transição `processando → revisao`
quando todas as famílias saem de pendente/processando (*`20260609132501_lote_transicao_revisao.sql`*).

### `familias`
Um PAI = um anúncio. Guarda identidade, resultado da IA, estado de publicação e auditoria de
edição. *Migration `20260527125643_familias_variacoes.sql` (ADR-0007/0008/0009).*

Grupos de colunas:
- **Identidade:** `lote_id` (FK→lotes, cascade), `user_id`, `org_id` (FK organizations,
  ADR-0027), `codigo_pai`, `nome_pai`, `descricao_pai`, `unidade`. Único: `(lote_id, codigo_pai)`.
- **Idempotência do cadastro manual (ADR-0096):** `chave_cadastro uuid` (nullable — só o
  cadastro manual preenche; o caminho de planilha deixa null). Índice único parcial
  **`familias_org_chave_cadastro_key`** em `(org_id, chave_cadastro) where chave_cadastro is
  not null`: reenvio da mesma submissão (uuid gerado pelo front ao abrir o diálogo) devolve o
  cadastro original em vez de criar um segundo produto. *Migration
  `20260731192443_codigo_produto_automatico.sql`.*
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
- **Descrição UP (ADR-0088, 2026-07-23):** `descricao_status`/`descricao_erro` (mesmo padrão de
  `atacado_status`/`atacado_erro`) — resultado durável do push da seção "🎨 CORES DISPONÍVEIS" pra
  todos os N itens ativos após mudança de composição; `null`/limpo em sucesso, `'erro'`+mensagem em
  qualquer falha (push ou persistência). Badge `descrição ⚠` na Revisão só quando há erro (sinal
  raro, ao contrário do par sempre-visível do atacado). *Migration
  `20260723211633_adr88_descricao_status.sql`.*
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
- **Config por faixa (ADR-0078 F2):** `exibir_com_desconto` (bool, null), `desconto_pct` (numeric, null),
  `atacado` (jsonb `FaixaAtacado[]`, null). NULL = herda o família-level (uniforme, comportamento clássico);
  explícito = config da faixa de preço da variação ([] = explicitamente sem atacado). Grupo de preço
  divergente herdando config família-level ATIVA sem confirmação → publish falha LOUD (ADR-0055).
  *Migration `20260717131407_preco_por_variacao_config_grupo.sql`.*
- **Dimensões:** `peso_gramas`, `altura_cm`, `largura_cm`, `comprimento_cm`.
- **Cor (ADR-0004/0029):** `cor`, `cor_hex`, `cor_origem`, `cor_editada_pelo_operador`.
- **Foto:** `imagem_path`, `ml_picture_id`.
- **Catálogo (ADR-0021):** `catalog_product_id`, `catalog_listing_id`,
  `catalog_status` (`pendente`/`vinculado`/`sem_produto`/`family_diff`/`nao_elegivel`/`erro`),
  `catalog_erro`.
- **Resultado/exclusão:** `ml_variation_id`, `excluida_da_publicacao`.

#### Guardas contra gravação administrativa direta

A migration `20260804113000_guard_manual_product_direct_writes.sql` reforça o isolamento do
ADR-0027 também para sessões administrativas, que podem contornar o RLS por desenho:

- `lotes.org_id` e `lotes.origem` não podem mudar depois da criação;
- `familias` e `variacoes` devem manter o mesmo `org_id` de seus pais;
- lote manual só aceita família com `chave_cadastro`, códigos de oito dígitos e variação com
  estoque inicial zero;
- alterações de saldo só passam por `registrar_entrada`, `baixar_estoque` ou
  `estornar_estoque`, mantendo saldo e `estoque_movimentos` na mesma transação.

As três RPCs pertencem ao papel interno `estoque_rpc_executor` (`NOLOGIN`, sem `BYPASSRLS`) e
usam políticas RLS mínimas e explícitas. O papel `postgres` não recebe capacidade de `SET` nem
herança desse executor após a migration.

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

**Atacado por partição (ADR-0078 F2):** `atacado_status` (`aplicado`/`erro`/null), `atacado_erro`.
`familias.atacado_status` passa a ser o agregado (algum erro → erro; algum aplicado → aplicado).
*Migration `20260717131407_preco_por_variacao_config_grupo.sql`.*

**User Products / multi-cor (ADR-0088):** três colunas novas, todas nuláveis/default seguro —
**`estado_desejado`** (`ativando`|`pausando`, alvo persistido de uma operação em lote de
ativação/pausa, limpo ao confirmar o estado terminal), **`skus_esperados`** (`jsonb`, snapshot
exato do conjunto de SKUs esperados da partição — não um inteiro; agregação exige igualdade de
conjunto, não contagem), **`mudando_composicao`** (`boolean not null default false`, marcador
transitório de mudança de composição em andamento). Nova constraint **`unique (id, org_id)`**, base
da FK composta da tabela filha abaixo. *Migration
`20260722145236_adr88_user_products_itens_e_formato.sql`.*

**Reconciliador de convergência (ADR-0088, 2026-07-23):** **`reconciliacao_tentativas`**
(`int not null default 0`, incrementada 1x por passada do reconciliador sobre a raiz via claim
atômico, zerada ao convergir), **`mudando_composicao_familia_id`** (`uuid references familias(id)
on delete set null` — referência DURÁVEL à família que iniciou o episódio, gravada por
`iniciarComposicao` no mesmo UPDATE que liga `mudando_composicao=true`; nunca inferida por
recência — múltiplas linhas de `familias` compartilham o mesmo `codigo_pai`, 1 por lote de UPDATE).
RPC `reconciliar_convergencia_claim(p_root_id, p_atualizado_antes)` (`security definer`): um único
UPDATE que re-checa `mudando_composicao=true` e `atualizado_em` velho e incrementa
`reconciliacao_tentativas` atomicamente — zero linhas retornadas = "outra execução/worker já tocou
esta raiz, pule". *Migration `20260723215424_adr88_reconciliacao_tentativas.sql`.*

### `anuncios_externos_itens`
Item **técnico** UP: um por SKU/cor, filho da partição comercial (`anuncios_externos`) — categorias
do ML que exigem "item plano" (`family_name`, sem `variations[]`) publicam N cores como N itens
separados linkados pelo mesmo `family_id`, nunca 1 item com N variações (ADR-0088).
*Migration `20260722145236_adr88_user_products_itens_e_formato.sql`.*

`id`, `anuncio_externo_id` + `org_id` (FK **composta** `(anuncio_externo_id, org_id) →
anuncios_externos(id, org_id) on delete cascade` — a filha herda a org do pai, nunca declara a
própria), `variacao_id` (FK `variacoes(id) on delete set null`, **nulável** — ponteiro de
rastreabilidade best-effort, não a ancoragem; muda a cada re-ingest), `sku` (identidade estável —
ancoragem real é **`unique (anuncio_externo_id, sku)`**), `retirado` (boolean, cor removida num
UPDATE — item pausado no ML, linha preservada como histórico, fora da agregação), `status`
(`pendente|criacao_incerta|criado|pausado|ativo|compensacao_pendente|remocao_pendente|erro`),
`item_externo_id`/`user_product_id`/`family_id`/`permalink` (nuláveis até existir no ML). Índices
únicos parciais: `(org_id, item_externo_id)` e `(user_product_id)` onde não-nulos. RLS: só-leitura
org-scoped no app (`select org`); escrita é `service_role`-only.

**Vinculação de catálogo (ADR-0021/0088 Fase 2)** — *migration `20260722175451_adr88_catalogo_up.sql`*:
`catalog_product_id`/`catalog_listing_id`/`catalog_status`/`catalog_erro`, espelhando as colunas
homônimas de `variacoes` (mesmo `check` de `catalog_status`: `pendente|vinculado|sem_produto|
family_diff|nao_elegivel|erro|ficha_divergente`). Diferença: aqui são **nuláveis sem default**
(em `variacoes` é `not null default 'pendente'`) — `null` é o sentinela de "ainda não avaliado";
o código trata os dois casos (`null` e `'pendente'`) como equivalentes. GTIN não é duplicado aqui:
resolvido em runtime via join com `variacoes` (por `variacao_id`, com fallback por `sku`).

### `ml_formato_publicacao`
Cache do formato de publicação (`legacy`|`user_products`) por conexão+categoria — só orienta o
CREATE (seed a partir da assinatura reativa confirmada, ADR-0087/0088), **nunca** usado no UPDATE
(que segue 100% `GET`-ao-vivo). PK `(connection_id, categoria_id)`. RLS: leitura via `exists` contra
`marketplace_connections` (não tem `org_id` direto); escrita `service_role`-only.
*Migration `20260722145236_adr88_user_products_itens_e_formato.sql`.*

---

## Estoque (ADR-0094)

> **Bloco A** (ledger + baixa/estorno atômicos + push cross-canal) **EM PRODUÇÃO** desde
> 2026-07-29. **Bloco B** (cadastro manual de produto + entrada de mercadoria pela UI, gated por
> módulo) **EM PRODUÇÃO desde 2026-07-29** — migration `20260729124711_e6b_origem_lote_e_modulos.sql`
> (`lotes.origem`, `organizations.modulos_habilitados`, `modulos_habilitados_da_org()`) e as
> edges `cadastrar-produto` / `entrada-estoque`.

### `estoque_movimentos`
Ledger imutável de toda alteração de saldo de estoque — venda, entrada, estorno. Única forma de
alterar `variacoes.estoque`: a escrita direta é bloqueada por trigger (ver abaixo).
*Migration `20260729084329_e6b_estoque_movimentos.sql`.*

Colunas: `id`, `org_id` (FK organizations), `codigo` (SKU interno = `variacoes.codigo`),
`codigo_pai` (default `''`, preenchido ao resolver a variação canônica), **`quantidade`** (o
**delta REALMENTE APLICADO** ao saldo — negativo=baixa, positivo=entrada/estorno; **nunca** o valor
pedido: com saldo 2 e venda de 5, `greatest(0,…)` só remove 2, então `quantidade = -2`, não `-5` —
gravar `-5` faria o estorno devolver 5 e criar 3 unidades do nada), **`quantidade_pedida`** (o que o
pedido pediu, auditoria/alerta de venda-sem-saldo), `motivo` (check: `venda`, `entrada`,
`estorno_venda`, `venda_sku_nao_encontrado`, `estorno_sku_nao_encontrado`, `cancelamento_sem_baixa`
— tombstone de cancelamento que chegou antes da baixa existir —, `venda_cancelada_antes`,
`ajuste` — redução manual, ADR-0110; `quantidade` sempre `<= 0`, e `0` quando o operador conferiu
sem mudar nada),
`canal_origem`, `referencia_externa` (idempotência), `custo_unitario numeric(12,2)` (só em
`entrada`), `documento` (NF do fornecedor), `observacao`, `estoque_anterior`, `estoque_resultante`,
**`push_enfileirado_em`** (outbox no próprio ledger: marca quando o push foi de fato aceito pelo
QStash — sem isso, uma RPC que commita seguida de enfileiramento que falha vira perda permanente),
**`push_canal_origem`** (a **intenção** de propagação gravada por quem criou o movimento: venda =
canal da venda que já se decrementou sozinho; entrada/estorno = `null` = todos os canais — um
despachante genérico que reusasse um único `canal_origem` por lote confundiria as duas políticas),
`criado_por` (FK auth.users), `criado_em`.

Índices:
- **`estoque_movimentos_ref_uniq`** — unique **parcial** `(org_id, referencia_externa) where
  referencia_externa is not null`: idempotência (referência nula não bloqueia nada, então a baixa
  exige referência obrigatória a nível de função).
- `estoque_movimentos_org_pai_idx` — `(org_id, codigo_pai, criado_em desc)`.
- `estoque_movimentos_org_codigo_idx` — `(org_id, codigo, criado_em desc)`.
- `estoque_movimentos_push_pendente_idx` — `(org_id, criado_em) where push_enfileirado_em is null
  and codigo_pai <> ''`: varredura do outbox.

RLS: policy `"estoque_movimentos: select org"` (`for select to authenticated using org_id =
(select current_org_id())`); **sem policy de escrita** — só `service_role`, via as RPCs abaixo.
`grant select ... to authenticated` é obrigatório **além** da policy (privilégio de tabela e RLS
são checagens independentes; mesmo padrão de `notificacoes`, ADR-0085).

**Funções `security definer`** (`search_path=''`), revogadas de `public`/`anon`/`authenticated` e
concedidas só a `service_role` (as RPCs nunca são chamadas pelo browser — sempre via edge com
`service_role`, D-15):

| Função | Papel |
|---|---|
| `baixar_estoque(p_org uuid, p_codigo text, p_qtd integer, p_canal text, p_ref text) returns jsonb` | Baixa atômica e idempotente (D-8). Advisory lock por `(org, ref)` compartilhado com o estorno; consulta o tombstone de cancelamento antes de aplicar; resolve a variação canônica (família mais recente do `(org_id, codigo)`); `estoque = greatest(0, estoque - qtd)`, nunca negativo. |
| `estornar_estoque(p_org uuid, p_canal text, p_ref_venda text, p_codigo text) returns jsonb` | Repõe só o que foi **de fato** baixado — lê `abs(quantidade)` do movimento `'venda'` original (D-7). Sem venda registrada, grava o tombstone `cancelamento_sem_baixa` na referência `estorno:<ref_venda>`, para a execução `paid` posterior recusar a baixa. |
| `registrar_entrada(p_org uuid, p_codigo text, p_qtd integer, p_custo numeric, p_doc text, p_obs text, p_criado_por uuid, p_ref text) returns integer` | Entrada de mercadoria (D-9). Soma `estoque`; sobrescreve `variacoes.custo` só quando `p_custo` é informado **e** `> 0` — custo `<= 0` levanta exceção (nunca vira default silencioso, é caminho financeiro ADR-0055); `p_ref` obrigatório (idempotência). |
| `ajustar_estoque(p_org uuid, p_codigo text, p_novo_saldo integer, p_obs text, p_criado_por uuid, p_ref text) returns integer` *(ADR-0110, migration `20260811201026`)* | Ajuste manual: grava `variacoes.estoque = p_novo_saldo` e um movimento `'ajuste'` com o **delta** (`novo - anterior`, sempre `<= 0`). **Só reduz** — `p_novo_saldo > saldo atual` levanta exceção apontando para a Entrada, porque entrada exige custo e é ele que alimenta markup (ADR-0055). Faixa `0..99999` (teto do ML, ADR-0048). `insert`-first como `baixar_estoque`: a idempotência (`p_ref`, obrigatória) vem antes do `for update`, para um retry duplicado não segurar a linha de `variacoes` à toa. Devolve o novo saldo, ou `null` quando a referência já tinha sido aplicada. Pertence ao role `estoque_rpc_executor` (ver trigger abaixo). |
| `limpar_movimentos_orfaos(p_org uuid) returns integer` *(ADR-0097, migrations `20260801091410` + `20260801092323`)* | Apaga os movimentos da org cujo `codigo` não existe mais em nenhuma `variacoes` viva; devolve quantos removeu. **Nunca toca `cancelamento_sem_baixa` (tombstone do D-19 — guarda funcional lida por `baixar_estoque`), `venda_sku_nao_encontrado`, `estorno_sku_nao_encontrado` nem `venda_cancelada_antes`**: os quatro nascem sem variação por construção e não pertencem a produto nenhum. Chamada por `excluir-lote` e `remover-publicado` **depois** do delete das famílias commitar — antes, o cascade das variações ainda não rodou e o conjunto sairia vazio. É **anti-join**, não "os códigos recém-apagados": `excluir-lote` preserva famílias publicadas (ADR-0019 D-1) e o mesmo `codigo_pai` tem várias famílias após ciclos de UPDATE, então um SKU vivo em outra linha mantém o histórico dele. Auto-curativa: absorve órfão antigo sem script avulso. |

**Trigger `variacoes_bloquear_escrita_direta_estoque`** (`before update of estoque on
public.variacoes`, executa `bloquear_escrita_direta_estoque()`, D-20): bloqueia qualquer `UPDATE`
que mude `variacoes.estoque` de fato (`is distinct from`, então reenviar o mesmo valor passa)
sempre que `current_user` **não** for `estoque_rpc_executor` — role sem login criado pela migration
`20260804113000_guard_manual_product_direct_writes.sql` (incidente 2026-08-03: produto inserido
direto com `service_role`, contornando RLS e ledger). As RPCs de estoque **pertencem** a esse role;
`service_role`, `authenticated` e `anon` **não** conseguem assumi-lo, então nenhuma via da
aplicação grava saldo sem passar por uma RPC. **Exceção conhecida desde 2026-08-11:** `postgres`
voltou a ser membro do role (efeito do `grant` exigido pelo `alter owner` da migration
`20260811201026`, gravado com `grantor = supabase_admin` e por isso não revogável por `postgres`),
de modo que quem usa essa credencial — SQL do dashboard, Management API — pode `set role` e
escrever saldo direto; ver a pendência em `docs/TASKS.md`. **Uma RPC de estoque nova precisa do
`alter function … owner to estoque_rpc_executor`** ou falha com `42501` na primeira escrita real. É trigger e não
`revoke update (estoque)` porque privilégios de coluna são **cumulativos** em Postgres: como
`authenticated` já tem `UPDATE` na tabela inteira, revogar só a coluna seria inócuo. Toda mudança
de saldo passa por entrada, baixa, estorno ou **ajuste** (ADR-0110) — nunca por `UPDATE` do app.

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
(`bruto − comissão − frete real`, não vem do MP desde o ADR-0042), `estorno`, `currency`.
Envio: `shipping_id/status/substatus/logistic`, `tracking_number`.
Financeiro: `money_release_date`, `liberacao_notificada_em` (ADR-0040),
`sacado_em`/`sacado_por` (*migration `20260702162832_ml_vendas_saque.sql`*) — marca manual de
saque no Financeiro > Detalhe do líquido, escrita só via RPCs `security definer`
`registrar_saque_ml_vendas(uuid[])` / `desfazer_saque_ml_vendas(uuid[])`
(exigem `is_membro_operacao()`; `registrar` só marca linhas com `money_release_date` já liberado).
Desde *migration `20260720013021_ml_vendas_saque_touch_atualizado_em.sql`* (ADR-0082) as duas RPCs
também bumpam `atualizado_em`, contrato exigido pelo poll incremental de `useVendas`: todo writer
que altera coluna exibida na UI de vendas precisa bumpar `atualizado_em`, senão a mudança fica
cega ao delta até o próximo fetch completo.
Classificação: `is_publiai` (match GTIN/família — ADR-0045), `tem_devolucao`. `raw jsonb`.
Único `(user_id, order_id)`; índice `(user_id, date_closed DESC)` (lookups pontuais de workers,
service_role, sem RLS); índice `(org_id)` (*migration `20260705165131_e7_org_id_dominio.sql`*,
mesma fase E7, cobre a RLS `org_id = current_org_id()`); índice `(org_id, date_closed DESC)`
(*migration `20260808102551_ml_vendas_org_index.sql`*) — composto que serve o mesmo predicado de
RLS junto do range/ordenação de `buscarVendas`, tornando o índice `(org_id)` puro redundante
(candidato a drop futuro, sem urgência, ~40 kB). **Correção 2026-08-08:** a migration nasceu de um
diagnóstico errado ("nenhum índice em `org_id` existia") — auditoria (Opus) achou o índice
`(org_id)` já ativo desde 05/07 e a tabela com só ~4,4 MB, tamanho onde seq scan não é lento. O
índice novo não é nocivo mas não resolve a lentidão de "unidades vendidas" relatada no Publicados;
suspeito real ainda não medido: janela `preset` de `useVendas` refaz o fetch completo (paginado,
com embeds) a cada montagem da tela (comentário em `src/hooks/useVendas.ts`), e/ou a chamada ao
vivo à API do ML em `status-publicados`. Ver `docs/TASKS.md`.

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

### `venda_item_custo`
Custo do produto **congelado no instante da venda**. *Migration `20260807210100_venda_item_custo.sql`
(ADR-0109); backfill em `20260807211252_backfill_venda_item_custo.sql`.*
`venda_id` (FK→ml_vendas, cascade), `ml_item_id`, `variation_id`, `codigo`, `custo_unitario`,
`congelado_em`, `fonte` (`sync` | `backfill`).

Tabela **satélite** e não uma coluna em `ml_vendas_itens` porque `upsertVenda` apaga e reinsere
todos os itens a cada sync do pedido (pago → enviado → entregue) — uma coluna seria descongelada a
cada notificação. Aqui o `DELETE` dos itens não alcança.

Unicidade `(venda_id, ml_item_id, variation_id)` com **`nulls not distinct`**: item sem variação é
o caso comum, e no Postgres `NULL` não colide com `NULL` num índice único. Índice de expressão
(`COALESCE`) não serve — o `ON CONFLICT` do supabase-js só infere arbiter por lista de colunas.

**Insert-once:** gravação com `ignoreDuplicates` (ON CONFLICT DO NOTHING) + trigger
`venda_item_custo_bloquear_update`, que faz qualquer `UPDATE` de `custo_unitario` **falhar**.
Corrigir um custo congelado exige `alter table ... disable trigger` explícito. `DELETE` segue
livre (o cascade da venda depende dele).

`fonte = 'backfill'` marca o que foi reconstruído pelo lote vigente na data da venda —
aproximação, não captura ao vivo.

### `ml_devolucoes`
Claims/devoluções. *Migration `20260622193401_faturamento_devolucoes.sql` (ADR-0037).*
`claim_id` (único com user), `order_id`, `stage`, `status`, `type`, `reason_id/texto`,
`valor_em_jogo`, `return_status`, `return_status_money`, `acoes_pendentes jsonb`,
`aberto_em`, `fechado_em`, `raw jsonb`.
`fechado_em` (*migration `20260806151323_devolucoes_fechado_em.sql`, ADR-0106*) é
`claim.resolution.date_created` — quando o ML resolveu o claim, que é o **mesmo instante** do
estorno no MP. É a data pela qual o Dashboard põe a devolução no período; `aberto_em` (quando o
comprador reclamou) podia cair em outro mês. Null enquanto o claim está aberto; a migration
backfilla o histórico a partir do `raw`.
`valor_em_jogo` sempre vem `null` — a API de claims do ML (`/post-purchase/v1/claims`) não traz
nenhum campo monetário. O valor exibido na UI (aba Devoluções, Dashboard) é `ml_vendas.estorno`
(reembolso já confirmado via Mercado Pago, ADR-0038), lido no client por `buscarDevolucoes`
(`src/lib/devolucoes.ts`), não a coluna `valor_em_jogo`.

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

### `notificacoes`
Notificação in-app, espelho do alerta Telegram. *Migration `20260721094323_notificacoes_in_app.sql`
(ADR-0085).* `user_id`, `org_id` (NOT NULL), `categoria` (mesmo enum textual de
`profiles.telegram_categorias`), `texto` (mesma string formatada enviada ao Telegram, já com o
link quando houver), `lida`, `criada_em`. Gravada pelo mesmo ponto único que dispara o Telegram
(`notificarCategoria`, `_shared/notificacoes/config.ts`) — todo assinante de uma categoria recebe,
com ou sem Telegram configurado. RLS `select own`; escrita só do worker (`service_role`, bypassa
RLS), mesmo padrão de `ml_mensagens`. RPC `marcar_notificacoes_lidas(p_ids uuid[] default null)`
marca todas (default) ou um subconjunto, só do próprio usuário.

### `configuracoes`
Settings por **organização** desde o E7 (era por usuário). *Migrations `20260606120614` +
`20260622121259` (ADR-0017/0035/0040) + `20260703113001` (ADR-0055) + `20260704120000`
(ADR-0059) + `20260705174455_e7_config_org.sql` (ADR-0027).*
`user_id` (PK, legado), `org_id` (FK organizations, `NOT NULL`, **único** — 1 configuração por
org), `desconto_pct`, `telegram_ativo`, `telegram_chat_id`, `telegram_bot_token` (sensível —
nunca retornado; lido via RPC `telegram_config_status()` que só informa `tem_token boolean`),
`aliquota_nacional_pct` (default 8), `aliquota_importado_pct` (default 16) — alíquotas por org,
sem override por família (ADR-0055) —, **`uf_empresa`** (text, nullable) e
**`aliquota_interna_pct`** (numeric, nullable) — UF de origem da empresa e alíquota das vendas
entregues nessa UF (ADR-0112, migration `20260812004735_adr112_aliquota_interna_uf.sql`);
CHECK garante os dois preenchidos ou os dois nulos, UF em 2 letras maiúsculas e percentual em
0–100. Nulos = parâmetro desligado → vale a alíquota por origem. Só a apuração pós-venda usa
esse par; o preço sugerido continua na origem —, `desconto_concorrencia_pct` (default 5) — percentual
abaixo do menor concorrente aplicado por `sugerirPrecoVenda` (ADR-0059, antes fixo em 5%) —,
`reancora_lider_ativa` (default false, migration `20260708144126`, ADR-0065) — liga a re-âncora
do preço no menor preço entre concorrentes MercadoLíder quando o preço competitivo dá prejuízo —,
`mostrar_lucro_dashboard` (default false, migration `20260717112328_mostrar_lucro_dashboard.sql`)
— liga a exibição do lucro (`lucro R$ X`) no card "Líquido no faturamento" do Dashboard —,
**`ai_model_texto`/`ai_model_imagem`** (text, nullable, ADR-0074, migration
`20260713120000_ai_model_por_org.sql`): slug OpenRouter do modelo de IA da org, lista curada via
CHECK constraint (texto: `openai/gpt-4.1-mini` padrão ou `openai/gpt-4o-mini`; imagem, hoje
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
| `start_support_session(request_id, requester_id, now)` | Inicia uma sessão aprovada ou renova atomicamente nos 15 minutos finais; somente `service_role` |
| `cleanup_support_audit_events()` | Remove auditoria com mais de um ano sem `legal_hold`; chamada pelo cron diário |
| `org_id_default()` | Trigger `BEFORE INSERT`: preenche `org_id` do INSERT a partir de `current_org_id()` quando ausente |
| `proximo_numero_lote(org)` | Incrementa `organizations.lote_seq` e retorna o próximo `numero_org` (row-lock na org) |
| `proximo_codigo_produto(p_org, p_qtd, p_resync default false)` | ADR-0096: reserva `p_qtd` números de `organizations.produto_seq` num `update … returning` atômico e devolve o **último** da faixa; rejeita `p_qtd <= 0`. Com `p_resync=true`, primeiro eleva a sequência ao maior código existente na org (comparação numérica) antes de reservar — caminho da colisão, não do cadastro feliz. `search_path=''`, revogada de `public`/`anon`/`authenticated`, concedida só a `service_role` — o browser nunca chama, só a edge `cadastrar-produto` |
| `upsert_marketplace_connection(...)` | Grava conexão de canal por org, criando/atualizando secrets no Vault |
| `get_connection_tokens(connection_id)` | Lê tokens descriptografados do Vault (só `service_role`) |
| `delete_marketplace_connection(connection_id)` | Remove conexão + secrets (idempotente) |
| `canais_habilitados_da_org()` | `security definer`, `search_path=''`: retorna `organizations.canais_habilitados` da própria org (evita abrir SELECT direto em `organizations`) |
| `telegram_config_status()` | Retorna `(chat_id, ativo, tem_token)` sem expor o token |
| `marcar_mensagens_lidas(pack_id)` | Marca as mensagens recebidas de um pack como lidas (limpa o badge da conversa) |
| `contar_conversas_aguardando()` | Conta packs de `ml_mensagens` do chamador cuja última mensagem (`data_ml desc nulls last, message_id desc`) é `recebida` — badge do menu, sem baixar a tabela inteira (plan 036) |
| `reconciliar_convergencia_claim(p_root_id, p_atualizado_antes)` | ADR-0088: claim atômico de uma raiz travada em `mudando_composicao=true` — reserva service_role-only |
| `reconciliar_backfill_up_candidatas(p_org_id)` | ADR-0088: lista candidatas ao backfill UP server-side (sem truncar por paginação) — service_role-only |
| `reconciliar_backfill_up_upsert(...)` | ADR-0088: upsert atômico raiz+filho do backfill UP numa única transação — service_role-only |
| `adotar_familia_migrada_up(...)` | ADR-0104/0105: adota numa única transação uma família que o ML migrou (ou **dissolveu**) em User Products — raiz (partição 0 + `skus_esperados` com o conjunto EXATO), N linhas filhas, `variacoes.ml_variation_id` nulado (UP não tem variações) e `familias.ml_item_id` re-apontado. ADR-0105: recebe `p_ml_item_id_antigo` e re-aponta **todas** as famílias do mesmo `codigo_pai` que apontavam para o item dissolvido (há uma família por lote); as que apontam para outro anúncio ficam intocadas. ADR-0105 §5.1: `ml_permalink` (famílias) e `permalink` (raiz) são re-apontados **junto** com o id, derivados do filho representante — todo link "ver anúncio" da UI sai desses campos. Só escrita local; nada toca o ML. service_role-only |
| `baixar_estoque(p_org, p_codigo, p_qtd, p_canal, p_ref)` | ADR-0094: baixa atômica e idempotente de estoque na venda paga — service_role-only |
| `estornar_estoque(p_org, p_canal, p_ref_venda, p_codigo)` | ADR-0094: repõe só o que foi de fato baixado no cancelamento pré-despacho — service_role-only |
| `registrar_entrada(p_org, p_codigo, p_qtd, p_custo, p_doc, p_obs, p_criado_por, p_ref)` | ADR-0094: entrada de mercadoria, sobrescreve custo quando informado — service_role-only |
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
