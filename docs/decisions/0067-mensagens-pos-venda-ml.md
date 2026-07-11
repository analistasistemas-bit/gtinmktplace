# ADR-0067 — Mensagens pós-venda do Mercado Livre (inbox do pedido)

**Data:** 2026-07-11
**Status:** Aceito — implementado na branch `worktree-adr-mensagens-pos-venda` (PR #13). Validado em runtime no Supabase local (aba renderiza a conversa, badge, RPC `marcar_mensagens_lidas`). **Pendente de deploy + habilitar topic `messages` no DevCenter ML** para o fluxo ao vivo (ver "Pendências").
**Contexto relacionado:** ADR-0037 (webhook + workers de faturamento), ADR-0038 (fonte única `ml_vendas`), ADR-0040 (notificação Telegram), ADR-0046 (`verify_jwt=false` nos workers), fluxo atual de Perguntas (`_shared/faturamento/perguntas-io.ts`, `sync-pergunta`).

## Contexto

A aba **Faturamento → Perguntas** só ingere e exibe **perguntas pré-venda** (anúncio),
via `GET /questions/search` + `/questions/{id}` (topic `questions`). As **mensagens
pós-venda** — o chat que o comprador abre depois da compra, vinculado a um pedido/pack
(ML: *Pós-venda → Mensagens de venda*) — vivem em outra API (`/messages/packs/...`) e
**hoje não são ingeridas em lugar nenhum**:

- O webhook (`ml-webhook/index.ts:11-16`) só roteia `orders_v2`, `shipments`, `questions`,
  `claims`. **Não há topic `messages`.**
- O único uso da API de mensagens é **envio** — a mensagem de boas-vindas quando o pedido é
  pago (`_shared/ml/mensagem.ts:11`, chamado em `sync-venda/index.ts:81`). Não há nenhum `GET`.

Consequência prática (incidente que motivou este ADR): uma mensagem do comprador
("preciso de mais 50m do mesmo tecido, consegue valor melhor?") ficou invisível no PubliAI —
o operador só a vê no painel do próprio Mercado Livre.

## Decisão

Ingerir e exibir mensagens pós-venda **espelhando o fluxo maduro de Perguntas** — mesma
espinha (webhook → dedup → QStash → worker → tabela local → tela DB-driven → notificação
Telegram). Nada de arquitetura nova.

### 1. Ingestão

- **Webhook:** adicionar ao `ROTA` de `ml-webhook/index.ts` o topic `messages` →
  `{ fn: 'sync-mensagem', campo: 'pack_id' }`. Dedup e ACK 200 já são genéricos, reaproveitados.
- **Configurar o topic `messages`** na aplicação do DevCenter ML (pendência **operacional**,
  igual foi feito para `questions`/`orders_v2`) — sem isso o ML não notifica.
- **Novo worker `sync-mensagem`** (cópia estrutural de `sync-pergunta`): `verify_jwt=false`,
  valida assinatura QStash, resolve conexão/token por `org_id`, busca a(s) mensagem(ns) do pack
  via API autenticada e faz upsert em `ml_mensagens`.

> **A confirmar na implementação:** o formato exato do `resource` da notificação `messages`
> (mensagem única vs. pack). O endpoint canônico de leitura do histórico é
> `GET /messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale&mark_as_read=false`.
> O worker busca o pack inteiro e faz upsert idempotente por `message_id` — assim funciona
> tanto se a notificação trouxer 1 mensagem quanto o pack.

### 2. Tabela nova `ml_mensagens`

Uma linha por mensagem (não por conversa). RLS por `user_id`/`org_id`; **read-only para o app**
(o worker escreve via `adminClient`). Colunas mínimas:

`user_id`, `org_id`, `pack_id`, `order_id`, `message_id` (unique por user), `direcao`
(`recebida`/`enviada`), `texto`, `data_ml` (timestamp da mensagem no ML), `lida bool`,
`item_titulo` (denormalizado, derivado do pedido — igual `perguntas.item_titulo`).

YAGNI explícito na v1: **sem anexos** (`message_attachments`), **sem threading próprio**
(ordena por `data_ml`), **sem templates de resposta**.

### 3b. "Aguardando resposta" e alerta global no avatar (refino 2026-07-11)

Feedback do Diego: o alerta deve ficar aceso no avatar do usuário (em qualquer tela) **até
respondido**, não até "lido". Como o operador responde tanto pelo PubliAI quanto pelo painel do
ML, o sinal correto é **stateless e agnóstico ao canal**: uma conversa está *aguardando resposta*
quando **sua última mensagem é do comprador** (`recebida`). Assim que existe uma resposta nossa —
enviada pelo PubliAI ou trazida do ML pelo backfill/webhook como `enviada` — a conversa deixa de
aguardar e o alerta some. Substitui o modelo anterior de `lida` marcado ao abrir a conversa (que
limpava o alerta só por visualizar, contrariando "até respondido"). O badge no avatar (`UserMenu`)
soma **perguntas `UNANSWERED` + conversas aguardando** e some quando tudo é respondido. A coluna
`lida`/RPC `marcar_mensagens_lidas` ficam vestigiais (mantidas para um futuro read-receipt).

### 3. Exibição — nova aba "Mensagens" em Faturamento

Nova aba ao lado de *Perguntas*, espelhando `aba-perguntas.tsx`: lista agrupada por pedido,
badge de **não-lidas**, campo de resposta e botão *Sugerir resposta (IA)* (reusa o mesmo
componente). Cada item linka para o **detalhe da venda** correspondente (a mensagem é sempre
de um pedido — ADR-0038/0039). **Responder reusa `enviarMensagemPedido`** (já existe); marcar
como lida é um `UPDATE` local.

*Alternativa considerada e descartada para v1:* exibir só dentro do detalhe da venda. Perde o
inbox unificado (operador não vê "o que há de novo" num lugar só) — que é justamente o que
faltou no incidente. A aba própria não impede o link para o detalhe.

### 4. Notificação Telegram

Reusar o padrão de `montarMensagemNovaPergunta` → `montarMensagemNovaMensagem`, disparado no
worker quando entra mensagem **recebida** nova, respeitando `lerConfigTelegram`.

### 5. Backfill — puxado para a v1

Originalmente previsto para a fase 2, o backfill foi **incluído na v1** como veículo de
validação (não depende do topic `messages` no DevCenter, ainda pendente). Implementado como
**passo 4 do `backfill-faturamento`**: após as vendas, varre os packs conhecidos em `ml_vendas`
e puxa as mensagens de cada um (1 GET/pack, sem alerta). É o que o botão "Sincronizar" da aba
Vendas dispara — então mensagens pós-venda entram junto com o histórico, mesmo antes do webhook.

## Consequências

- **1 migration** (`ml_mensagens` + RLS + índices por `pack_id`/`data_ml`), **1 edge function
  nova** (`sync-mensagem`), **1 IO shared** (`_shared/faturamento/mensagens-io.ts`), **1 aba**
  no front + hook/lib espelhando Perguntas. Zero dependência nova.
- **Pendência operacional:** habilitar o topic `messages` no DevCenter ML (sem isso não chega
  notificação) e conferir a janela em que o ML permite responder mensagens pós-venda.
- **Risco a validar cedo:** o formato do `resource` da notificação `messages` — resolver com 1
  webhook real de teste antes de fixar o parse (não confiar no corpo; buscar sempre autenticado,
  ADR-0037).
- Reversível: aba e tabela isoladas; desligar = parar de rotear o topic.

## Plano de implementação (ordem sugerida)

1. Migration `ml_mensagens` + RLS + RPC de marcar-lida/responder (se necessário). → `db:check`
2. `_shared/faturamento/mensagens-io.ts` (`buscarMensagensPack`, `upsertMensagem`) + testes.
3. Edge function `sync-mensagem` (molde `sync-pergunta`). → deploy CLI + confirmar versão.
4. Rota `messages` no `ml-webhook` + redeploy. Configurar topic no DevCenter.
5. Front: `lib/mensagens.ts`, `hooks/useMensagens.ts`, `components/faturamento/aba-mensagens.tsx`,
   registrar aba em `Faturamento.tsx`. Reusar "Sugerir resposta (IA)" e `enviarMensagemPedido`.
6. Notificação Telegram. Atualizar `docs/reference/edge-functions.md` e obsidian-vault.
7. (Fase 2) `backfill-mensagens`.
