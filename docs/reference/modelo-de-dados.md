# Referência — Modelo de dados

> **Tipo:** Reference (Diátaxis). Schema Postgres do PubliAI. Fonte: `supabase/migrations/`
> (DDL canônico — ADR-0043) e `src/lib/database.types.ts` (tipos gerados). Termos em
> [glossario.md](glossario.md). O "porquê" de cada decisão está nos ADRs citados.

## Regras transversais

- **RLS de operação compartilhada** (ADR-0047): as tabelas de domínio liberam leitura/escrita a
  qualquer membro autenticado via `public.is_membro_operacao()` (hoje `auth.role()='authenticated'`).
  `user_id` permanece como `criado_por` (auditoria). O isolamento por `org_id` chega no E7 (ADR-0027),
  redefinindo só o corpo de `is_membro_operacao()`.
- **`atualizado_em`** mantido por trigger `moddatetime` na maioria das tabelas.
- **Escritas sensíveis** (credenciais, faturamento) são bloqueadas para `authenticated` e só
  ocorrem via `service_role` (workers) ou RPC `security definer`.
- **Tokens** nunca em colunas de texto — ficam no **Vault** (`vault.secrets`).

## Acesso e usuários (ADR-0047)

### `profiles`
Espelho 1:1 de `auth.users` (`id` FK). Colunas: `email`, `nome`, `is_admin`, `is_active`,
`allowed_menus text[]` (chaves de menu que um não-admin acessa), `created_at`, `updated_at`.
Criado no signup pelo trigger `handle_new_user` (semeia `nome`/`allowed_menus` do
`raw_user_meta_data` do convite). RLS: SELECT do próprio ou de admin; INSERT/UPDATE/DELETE só admin.

**Helpers** (SECURITY DEFINER, `search_path=''`, execute só p/ `authenticated`):
- `public.is_admin()` — o chamador tem `profiles.is_admin`.
- `public.is_membro_operacao()` — o chamador é membro autenticado da operação (ponto único de
  troca p/ o E7).

## Relações de domínio

```
lotes (1) ──< familias (N) ──< variacoes (N)
                  │
                  └─ espelhado em ── anuncios_externos  [(user_id, canal, codigo_pai)]

ml_credentials (1 por user) ──► tokens OAuth no Vault

ml_vendas (1 por pedido) ──< ml_vendas_itens (N) ──► match com variacoes por GTIN/EAN
ml_vendas ──► ml_devolucoes (por order_id)
ml_perguntas        (independente, respondível pelo app)
ml_moderacao        (1 linha aberta por item moderado)
ml_webhook_eventos  (dedup de webhooks)
configuracoes (1 por user)
```

---

## Núcleo de publicação

### `lotes`
Um upload de planilha + imagens; inicia o pipeline. *Migration `20260527123422_enums_lotes_storage.sql` (ADR-0007).*

Colunas-chave: `id`, `user_id` (FK auth.users), `numero` (sequência, "Lote #N"),
`status` (`lote_status`), `planilha_path`, `imagens_paths text[]`,
`total_familias` / `total_publicadas` / `total_erros` (mantidos por trigger),
`erro_mensagem`, `criado_em`, `atualizado_em`.
Índice: `(user_id, criado_em DESC)`. RLS por `user_id`.
Trigger `update_lote_counters` recalcula contadores e faz a transição `processando → revisao`
quando todas as famílias saem de pendente/processando (*`20260609132501_lote_transicao_revisao.sql`*).

### `familias`
Um PAI = um anúncio. Guarda identidade, resultado da IA, estado de publicação e auditoria de
edição. *Migration `20260527125643_familias_variacoes.sql` (ADR-0007/0008/0009).*

Grupos de colunas:
- **Identidade:** `lote_id` (FK→lotes, cascade), `user_id`, `codigo_pai`, `nome_pai`,
  `descricao_pai`, `unidade`. Único: `(lote_id, codigo_pai)`.
- **Lifecycle:** `status` (`familia_status`), `operacao` (`operacao_ml`).
- **Categorização:** `tipo_aviamento`, `tipo_origem`, `categoria_ml_id`, `categoria_nome`.
- **Copy (IA):** `titulo_ml`, `descricao_ml`, `atributos_ml jsonb`, `tokens_input/output`.
- **Concorrência/mercado:** `analise_mercado jsonb`, `concorrencia_*`.
- **Preço:** `estrategia_preco`, `estrategia_motivo`, `custo_centavos` (ADR-0020/0042),
  `exibir_com_desconto`, `desconto_pct`.
- **Atacado (ADR-0041):** `atacado jsonb`, `atacado_status`, `atacado_erro`.
- **Fotos do PAI:** `capa_storage_path`/`capa_ml_picture_id` e `capa2_*`, `capa3_*`.
- **Envio (ADR-0009/0018):** `shipping_mode`, `frete_gratis`, `sale_terms jsonb`.
- **Resultado:** `ml_item_id`, `ml_permalink`, `publicado_em`.
- **Auditoria de edição:** `titulo_editado_pelo_operador`, `descricao_editada_pelo_operador`,
  `editado_em`, `observacao_operador`.
- **Processamento:** `erro_mensagem`, `qstash_message_id`, `variacao_principal_codigo` (ADR-0044).

Índices por `(user_id, codigo_pai)`, `(user_id, ml_item_id)`, `(lote_id, status)`. RLS por `user_id`.

### `variacoes`
Um SKU/cor = uma variação do anúncio. *Migration `20260527125643_familias_variacoes.sql`
(ADR-0003/0004/0018).*

Grupos:
- **Identidade:** `familia_id` (FK→familias, cascade), `user_id`, `codigo`, `nome`, `gtin`.
  Único: `(familia_id, codigo)`.
- **Estoque/preço:** `estoque`, `estoque_anterior`, `preco`, `preco_publicacao`,
  `preco_editado_pelo_operador`, `custo`.
- **Dimensões:** `peso_gramas`, `altura_cm`, `largura_cm`, `comprimento_cm`.
- **Cor (ADR-0004/0029):** `cor`, `cor_hex`, `cor_origem`, `cor_editada_pelo_operador`.
- **Foto:** `imagem_path`, `ml_picture_id`.
- **Catálogo (ADR-0021):** `catalog_product_id`, `catalog_listing_id`,
  `catalog_status` (`pendente`/`vinculado`/`sem_produto`/`family_diff`/`nao_elegivel`/`erro`),
  `catalog_erro`.
- **Resultado/exclusão:** `ml_variation_id`, `excluida_da_publicacao`.

### `anuncios_externos`
Espelho multicanal normalizado. Identidade estável independente de lote/família.
*Migration `20260614152627_anuncios_externos.sql` (ADR-0025).*

`id`, `user_id`, `canal` (`canal_externo`), `codigo_pai`, `item_externo_id`, `permalink`,
`status`, `erro_mensagem`, `variacoes_externas jsonb` (mapa `codigo → {variation_id,
catalog_product_id, catalog_listing_id, catalog_status}`), `metadados_canal jsonb`,
`preco_override`, `publicado_em`, **`particao smallint`**, **`titulo`**. Único:
`(user_id, canal, codigo_pai, particao)`. Populado por dual-write dos workers + backfill.
*Split (ADR-0048, migration `20260629180206_anuncios_externos_particao.sql`):* um produto com
>100 cores tem N linhas (uma por anúncio/partição); cada `variacoes_externas` é a **ancoragem**
(sku → anúncio). Produto ≤100 cores tem só `particao=0` (idêntico ao modelo original ADR-0025).

---

## Credenciais

### `ml_credentials`
Tokens OAuth do ML por usuário; tokens no Vault. *Migration `20260527141015_ml_credentials_vault.sql`.*

`user_id` (PK), `ml_user_id`, `ml_nickname`, `scope`, `expires_at`,
`access_token_secret_id`/`refresh_token_secret_id` (FK→`vault.secrets`).
SELECT pelo dono; INSERT/UPDATE/DELETE só via RPC `service_role`:
`upsert_ml_credentials`, `get_ml_tokens`, `delete_ml_credentials`.

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

### `ml_vendas_itens`
Itens de um pedido. *Mesma migration + `20260623104822` + `20260627095025` (unique).*
`venda_id` (FK→ml_vendas, cascade), `ml_item_id`, `variation_id`, `titulo`, `codigo`, `cor`,
`ean`, `quantity`, `unit_price`, `sale_fee`, `is_publiai`.

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

---

## Monitoramento e configuração

### `ml_moderacao`
Anúncios moderados/pausados + coordenação de alertas. *Migration `20260622115621_ml_moderacao.sql` (ADR-0035).*
`ml_item_id`, `status`, `motivo`, `detectado_em`, `alertado_em`, `resolvido_em`.
Índice único parcial `(user_id, ml_item_id) WHERE resolvido_em IS NULL` (evita alerta duplicado).

### `configuracoes`
Settings por usuário. *Migrations `20260606120614` + `20260622121259` (ADR-0017/0035/0040).*
`user_id` (PK), `desconto_pct`, `telegram_ativo`, `telegram_chat_id`, `telegram_bot_token`
(sensível — nunca retornado; lido via RPC `telegram_config_status()` que só informa
`tem_token boolean`).

---

## Storage

Bucket **`imagens`** (privado). Paths no formato `{user_id}/{lote_id}/{arquivo}`. RLS:
acesso só quando `auth.uid()` == primeiro segmento do path. *Migration `20260527123422`.*

---

## Funções SQL (`security definer`)

| Função | Papel |
|---|---|
| `update_lote_counters()` | Trigger: recalcula contadores de `lotes` + transição de status |
| `upsert_ml_credentials(...)` | Grava credenciais criando/atualizando secrets no Vault |
| `get_ml_tokens(user_id)` | Lê tokens descriptografados do Vault (só `service_role`) |
| `delete_ml_credentials(user_id)` | Remove credenciais + secrets |
| `telegram_config_status()` | Retorna `(chat_id, ativo, tem_token)` sem expor o token |

---

## O que **não** existe (YAGNI consciente)

- Sem `catalogo_interno` (cache cross-lote) — substituível por query em `familias`.
- Sem `jobs_log` — auditoria de fila vive no dashboard Upstash + `qstash_message_id`.
- Sem `org_id` ainda — multi-tenancy por `user_id`; organizações são o épico futuro E7 (ADR-0027).
- `canal_externo` só tem `mercado_livre` — ganha valor novo quando entrar o 2º canal.
