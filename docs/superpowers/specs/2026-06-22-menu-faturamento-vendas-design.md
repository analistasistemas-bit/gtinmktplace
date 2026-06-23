# Spec — Menu Faturamento (Vendas, Devoluções, Perguntas) do Mercado Livre

**Data:** 2026-06-22
**Status:** Aprovado (brainstorming)
**ADR:** [ADR-0037](../../decisions/0037-modulo-faturamento-webhooks-ml.md)
**Relacionado:** ADR-0024 (conectores), ADR-0027 (multi-tenancy/RLS), ADR-0031 (financeiro MP), ADR-0035 (Telegram), ADR-0006 (QStash), ADR-0012 (token ML)

## Objetivo

Um menu **Faturamento** que mostra as vendas reais do Mercado Livre **pedido a pedido**,
com árvore expansível de detalhamento, além de **Devoluções/Reclamações** e **Perguntas**
(com resposta assistida por IA). Os dados são **persistidos em tabelas locais**, alimentados
por **webhooks do ML** (tempo real) com **reconciliação periódica** de segurança, e disparam
**alertas Telegram** proativos.

Hoje o app só agrega vendas por produto (`metricas-vendas`, `DetalheFinanceiro`). Esta feature
expõe o pedido individual e o pós-venda, que a API já fornece e o código hoje descarta.

## Decisões do brainstorming

1. **Eixo:** pedido a pedido (cada linha = 1 pedido do ML), com dropdown/árvore de detalhe.
2. **Organização:** um menu `Faturamento` com 3 abas — Vendas, Devoluções, Perguntas.
3. **Dados:** persistir em tabelas + webhooks + worker de sync + backfill + reconciliação.
4. **Perguntas:** responder pelo app (`POST /answers`) com **sugestão de IA** (revisão humana).
5. **Escopo de pedidos:** todos os pedidos da conta ML, com selo PubliAI/Fora.
6. **Alertas Telegram:** nova venda, nova pergunta não respondida, nova devolução.

## Arquitetura

```
ML (evento) → ml-webhook (edge, verify_jwt=false, ACK 200 <500ms) → QStash
                                                                       ↓
                                  worker sync-{venda|pergunta|devolucao}
                                                                       ↓
                                  fetch autenticado do recurso na API ML
                                                                       ↓
                                  upsert nas tabelas (idempotente, por id ML)
                                                                       ↓
                                  alerta Telegram (se configuracoes.telegram_ativo)

backfill-faturamento   → varre /orders/search, /questions/search, /claims/search (12m)
reconciliar-faturamento → QStash schedule 1h: /missed_feeds + janela recente (rede de segurança)

Frontend → lê SEMPRE das tabelas locais (rápido, resiliente à API do ML)
```

**Princípios:**
- O receiver **nunca confia no corpo** do webhook (ML não assina com HMAC). Valida que o
  `user_id` do payload é uma `ml_credentials` conhecida, deduplica por `(topic, resource)`
  em `ml_webhook_eventos`, e sempre **refaz o fetch autenticado** do recurso.
- Workers **idempotentes**: upsert por id do ML (`order_id`/`question_id`/`claim_id`).
- Reconciliação cobre webhooks perdidos (entrega não garantida).

## Modelo de dados (Supabase, RLS por `user_id`)

### `ml_vendas` — 1 linha por pedido
| coluna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| user_id | uuid not null | RLS |
| order_id | bigint not null | id do pedido ML; unique (user_id, order_id) |
| pack_id | bigint null | carrinho/pacote (rateio de frete) |
| status | text | paid, cancelled, ... |
| status_detail | text null | |
| date_closed | timestamptz null | data da venda (ordenação) |
| date_created | timestamptz | |
| comprador_id | bigint null | |
| comprador_nick | text null | |
| total_amount | numeric | bruto |
| paid_amount | numeric null | |
| sale_fee_total | numeric | comissão ML somada dos itens |
| frete_vendedor | numeric null | custo de envio pago pelo vendedor |
| liquido | numeric null | total − sale_fee − frete_vendedor (estimado) |
| currency | text default 'BRL' | |
| shipping_id | bigint null | |
| shipping_status | text null | |
| shipping_substatus | text null | |
| tracking_number | text null | |
| is_publiai | boolean default false | algum item é de anúncio do app |
| tem_devolucao | boolean default false | atalho p/ badge (atualizado por sync-devolucao) |
| raw | jsonb | payload bruto (auditoria/expansão futura) |
| criado_em / atualizado_em | timestamptz | trigger |

### `ml_vendas_itens` — N por venda
| coluna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| user_id | uuid not null | RLS |
| venda_id | uuid not null | fk ml_vendas on delete cascade |
| ml_item_id | text | |
| variation_id | bigint null | |
| titulo | text | |
| codigo | text null | código do catálogo PubliAI (mapeado quando possível) |
| quantity | int | |
| unit_price | numeric | |
| sale_fee | numeric | |
| is_publiai | boolean default false | |

### `ml_devolucoes` — claims/returns
| coluna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| user_id | uuid not null | RLS |
| claim_id | bigint not null | unique (user_id, claim_id) |
| order_id | bigint null | |
| stage | text | claim / dispute / recontact |
| status | text | opened / closed |
| type | text | mediations / return / cancel_purchase / cancel_sale |
| reason_id | text null | |
| reason_texto | text null | tradução amigável do reason_id |
| valor_em_jogo | numeric null | |
| return_status | text null | |
| return_status_money | text null | retained / refunded / available |
| acoes_pendentes | jsonb null | [{action, due_date, mandatory}] |
| aberto_em | timestamptz null | |
| raw | jsonb | |
| criado_em / atualizado_em | timestamptz | |

### `ml_perguntas`
| coluna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| user_id | uuid not null | RLS |
| question_id | bigint not null | unique (user_id, question_id) |
| item_id | text | |
| item_titulo | text null | enriquecido p/ exibir |
| texto | text | |
| status | text | UNANSWERED / ANSWERED / ... |
| resposta | text null | |
| respondida_em | timestamptz null | |
| comprador_id | bigint null | |
| criada_em | timestamptz | |
| raw | jsonb | |
| atualizado_em | timestamptz | |

### `ml_webhook_eventos` — log/idempotência
| coluna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| user_id | uuid null | resolvido do payload quando possível |
| topic | text | orders_v2 / questions / claims / shipments |
| resource | text | path do recurso (chave de dedup) |
| recebido_em | timestamptz default now() | |
| processado_em | timestamptz null | |
| erro | text null | |

Unique parcial `(topic, resource)` recente para dedup. Mantida enxuta (limpeza opcional futura).

## Edge Functions

### Receiver
- **`ml-webhook`** (`verify_jwt = false`): valida formato, resolve `user_id` via `user_id` do
  payload → `ml_credentials.ml_user_id`; grava em `ml_webhook_eventos` (dedup); enfileira no
  QStash o job do tópico; responde **200 imediatamente**. Tópicos tratados: `orders_v2`,
  `payments`(→ resolve order), `shipments`(→ atualiza venda), `questions`, `claims`.

### Workers (consomem QStash, validam assinatura via `qstashReceiver`)
- **`sync-venda`**: `GET /orders/{id}` (+ `/shipments/{id}` se houver) → mapeia itens, calcula
  `is_publiai`/`codigo` (reusa `mapearPagamentoParaItem` + `familias`), upsert `ml_vendas`+itens
  → se nova venda paga, alerta Telegram.
- **`sync-pergunta`**: `GET /questions/{id}` → enriquece título do item → upsert → se
  `UNANSWERED` nova, alerta Telegram.
- **`sync-devolucao`**: `GET /post-purchase/v1/claims/{id}` (+ returns) → upsert; seta
  `ml_vendas.tem_devolucao` → alerta Telegram.

### Lote/agendados
- **`backfill-faturamento`**: varre histórico (orders 12m, questions, claims) e popula tabelas.
  Idempotente. Acionado no primeiro uso e por botão "Sincronizar". Paginação + resiliência
  espelhando `buscarPedidosML`.
- **`reconciliar-faturamento`**: QStash schedule 1h. `GET /missed_feeds?app_id=&topic=` +
  janela recente de orders/questions/claims → reprocessa o que faltou.

### Chamadas do frontend
- **`responder-pergunta`**: `POST /answers {question_id, text}` → atualiza `ml_perguntas`.
  Revisão humana sempre (texto vem do operador, podendo ter sido sugerido por IA).
- **`sugerir-resposta-pergunta`**: IA via `openrouterClient()` com contexto do anúncio
  (título, atributos) e a pergunta → retorna texto sugerido. **Não envia.**

## Frontend

Menu **Faturamento** no `sidebar.tsx` (ícone `Receipt`/`ReceiptText`), rota `/faturamento`.
Página `Faturamento.tsx` com `Tabs` (shadcn): `Vendas` · `Devoluções` · `Perguntas`.
Badge de contador de perguntas não respondidas no item do menu.

### Aba Vendas (principal)
- **KPIs** no topo (faturamento, pedidos, ticket médio, líquido) — reusa estilo dos cards de
  `metricas-vendas`/Publicados.
- **Tabela** pedido a pedido: `Data · Comprador · Resumo itens · Valor · Líquido · Status pgto
  · Status envio · selo PubliAI/Fora`. Badge "devolução" quando `tem_devolucao`.
- **Linha expansível (árvore)** → detalhamento do pedido: itens (título, qtd, unit_price,
  sale_fee), subtotais, frete, líquido estimado, rastreio (tracking), link p/ anúncio no ML.
- **Filtros:** período (7/30/90/personalizado), origem (PubliAI/Fora/Todos), status. Botão
  "Sincronizar" (dispara `backfill-faturamento`).

### Aba Devoluções
- Tabela: `Data · Pedido · Motivo · Tipo · Status · Valor em jogo · Ações pendentes (com prazo)`
  + link p/ o claim no ML. Ordena por ação pendente mais urgente.

### Aba Perguntas
- Não respondidas no topo. Linha: `Pergunta · Anúncio · Data`. Ações: campo de resposta,
  botão **"Sugerir resposta (IA)"** (preenche o campo) e **"Responder"** (envia via
  `responder-pergunta`). Estado otimista + invalidação React Query.

### Hooks/libs
- `src/hooks/useVendas.ts`, `useDevolucoes.ts`, `usePerguntas.ts` (React Query).
- `src/lib/faturamento.ts` (fetch das edge functions + tipos compartilhados).
- Cálculos puros e testáveis em libs (líquido, agrupamento de KPIs) — espelha `financeiro.ts`.

## Alertas Telegram

Reusa `_shared/notificacoes/telegram.ts` e `configuracoes.telegram_ativo/telegram_*`.
Funções `montarMensagemNovaVenda`, `montarMensagemNovaPergunta`, `montarMensagemNovaDevolucao`.
Disparados pelos workers, só em **eventos novos** (dedup pelo estado anterior na tabela).
Sem secret/flag → no-op silencioso (igual ADR-0035).

## Segurança / multi-tenancy
- RLS por `user_id` em todas as tabelas (padrão ADR-0027). Workers usam service role (bypass).
- Tokens via `getValidAccessToken(user_id)` (ADR-0012). Sem token → no-op por usuário.
- `ml-webhook` público mas inerte sem `user_id` válido e sem fetch autenticado bem-sucedido.

## Dependências manuais (fora do código — Diego)
1. **DevCenter ML:** cadastrar URL de notificações = endpoint público de `ml-webhook` e
   assinar tópicos `orders_v2`, `questions`, `claims`, `shipments` (e `payments` se desejado).
2. **QStash:** criar schedule de 1h → `reconciliar-faturamento` (como no ADR-0035).
3. Conexão ML com scope `write` (já existente) para responder perguntas.

> Sem (1), o tempo real não chega — mas **backfill + reconciliação** mantêm as telas
> populadas e funcionais. A feature é validável end-to-end via backfill (que usa `/orders/search`,
> já em produção) mesmo antes do webhook ser ligado no DevCenter.

## Faseamento

- **Fase 1 — Vendas:** migrations (`ml_vendas`, `ml_vendas_itens`, `ml_webhook_eventos`) +
  `ml-webhook` + `sync-venda` + `backfill-faturamento` + `reconciliar-faturamento` +
  aba Vendas + alerta venda.
- **Fase 2 — Perguntas:** `ml_perguntas` + `sync-pergunta` + `responder-pergunta` +
  `sugerir-resposta-pergunta` + aba Perguntas + alerta pergunta.
- **Fase 3 — Devoluções:** `ml_devolucoes` + `sync-devolucao` + aba Devoluções + alerta devolução.

## Critérios de sucesso (verificáveis)
- Testes unitários verdes para libs puras (mapeamento de pedido→linha, cálculo de líquido,
  dedup de webhook, montagem de mensagens Telegram, sugestão de resposta — parsing).
- `backfill-faturamento` popula `ml_vendas` com os pedidos reais dos últimos 30/90 dias
  batendo com os números já exibidos em Publicados/Detalhe de vendas.
- Aba Vendas lista pedidos, expande detalhe e filtra por origem/status/período.
- Aba Perguntas lista, sugere via IA e responde (estado atualizado).
- Aba Devoluções lista claims com ação pendente e prazo.
- Validação visual end-to-end com browser-use (telas reais, dados reais via backfill).

## Fora de escopo
- Billing fiscal (`/billing/integration/...`) — conciliação 1x/dia; futuro.
- Multi-tenant por org (E7) — tabelas já nascem com `user_id` para migração aditiva.
- Persistência >12 meses além do que a API entrega no backfill.
