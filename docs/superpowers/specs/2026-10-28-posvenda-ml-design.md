# Pós-venda do Mercado Livre dentro do PubliAI — design

**Data:** 2026-10-28 · **Pedido:** Diego · **Status:** aguardando aprovação do Diego

## Intenção

Diego ainda entra no painel "Pós-venda" do Mercado Livre
(`vendedores.mercadolivre.com.br/post-purchase/post-sales`) várias vezes por semana para
**revisar devoluções** e **responder/agir em reclamações**. O objetivo é resolver o pós-venda
inteiro pelo PubliAI, no menu Faturamento, sem abrir o ML.

O que já existe e não muda de natureza:
- Mensagens pós-venda sincronizam (webhook `messages` corrigido em 28/10, emenda ADR-0067) e
  são respondidas pelo PubliAI, com visual de WhatsApp (main `d7120b0d`).
- Reclamações e devoluções sincronizam em `ml_devolucoes` (webhook `post_purchase` + etapa
  `claims` do reconciliar horário), mas são **só leitura**: a UI mostra rótulos de ações
  pendentes e um link para o ML.

## Objetivos

1. **Organização igual à do ML** (decisão do Diego, mockup "A"): uma área Pós-venda com 3 abas
   — **Reclamações**, **Mensagens**, **Devoluções** — cada uma com os cards-resumo
   *Urgentes* / *Em andamento* (contadores clicáveis que filtram a lista) e uma lista de cards
   com o estado atual e o botão da próxima ação.
2. **Revisar devolução pelo PubliAI** (mockup aprovado):
   - Caminho "Chegou como eu enviei" → confirma no ML.
   - Caminho "Tem problema…" → um dos motivos que o ML devolve em
     `GET /post-purchase/v1/returns/reasons?flow=seller_return_failed&claim_id=` (hoje: avariado,
     incompleta, diferente do enviado, não está no pacote, outro defeito, ainda não chegou),
     **fotos como evidência** (Diego costuma anexar) e descrição opcional → envia ao ML.
   - Antes de decidir, o card mostra: motivo, data de chegada, rastreio, status do reembolso,
     se afeta reputação.
3. **Detalhe da reclamação com ações** (mockup aprovado):
   - Topo: produto, pedido, valor, **de quem é a vez e até quando** (`detail.action_responsible`,
     `detail.due_date`).
   - Estado com o **texto do próprio ML** (`detail.title`, `detail.description`,
     `detail.problem`), o que o comprador quer (`expected-resolutions`), etapa
     (claim/dispute), reputação (`affects-reputation`), custo da devolução
     (`charges/return-cost`).
   - Histórico: mensagens da reclamação (comprador, mediador do ML, você) + mudanças de status.
   - Ações, **só as que o ML libera naquele momento** (`players[seller].available_actions`);
     as demais aparecem desabilitadas com o motivo: Responder (com anexo), Reembolsar (total ou
     parcial), Autorizar devolução, Enviar evidência, Pedir mediação do ML (abrir disputa).
4. **Mensagens no padrão do ML**: os cards-resumo *Não lidas* (A preparar / Entregues) e
   *Lidas* (Sem responder / Respondidas) sobre a aba Mensagens atual.

## Não-objetivos

- Outros marketplaces (Shopee etc.) — só ML nesta entrega; nada que impeça depois.
- Iniciar conversa com o comprador (o ML bloqueia, emenda 2026-10-25 do ADR-0067).
- Automação de decisão (revisar/reembolsar sozinho). Toda ação parte de um clique humano.
- Código de autorização diário das devoluções (faixa do topo do ML) — não achamos endpoint;
  fica fora até aparecer.
- Notificações novas no Telegram — a categoria `pos_venda` atual segue como está.

## Anti-objetivos (falharia mesmo funcionando)

- Uma ação ir ao ML **sem confirmação explícita** na tela, ou o botão parecer ter funcionado
  quando o ML recusou.
- Mostrar ação que o ML não libera (o clique falharia) ou esconder o motivo de estar desabilitada.
- Reembolso/revisão duplicados por clique duplo, retry ou duas pessoas da org ao mesmo tempo.
- A tela dizer um estado diferente do ML depois de agir (ex.: "Revisada" no PubliAI e
  "Último dia para sua revisão" no ML).

## Restrições

- **API verificada em 28/10 (só leitura, conta Avil, 5 reclamações):** todos os `GET` abaixo
  responderam 200: `claims/{id}`, `/detail`, `/messages`, `/expected-resolutions`,
  `/affects-reputation`, `/evidences`, `/status-history`, `/charges/return-cost`,
  `v2/claims/{id}/returns` (404 quando a reclamação não tem devolução), `v1/returns/{id}/reviews`,
  `returns/reasons`. Respostas salvas fora do repo (dados de compradores).
- **Escrita — documentada, ainda não executada** (docs oficiais `gerenciar-devolucoes`,
  `gerenciar-mensagem-de-uma-eclamacao`, `gerenciar-resolucao-de-reclamacoes`,
  `gerenciar-evidencias-de-reclamacoes`):
  - `POST /post-purchase/v1/returns/{return_id}/return-review` (body vazio = OK; com motivo = falha)
  - `POST /post-purchase/v1/claims/{id}/returns/attachments` (foto da revisão com falha)
  - `POST /post-purchase/v1/claims/{id}/actions/send-message` + `POST .../attachments`
  - `POST .../expected-resolutions/refund`, `.../partial-refund` (`percentage`; ofertas em
    `GET .../partial-refund/available-offers`), `.../allow-return`
  - `POST .../actions/open-dispute`
  - `POST .../actions/evidences` + `POST .../attachments-evidences`
- **Permissão:** o token da Avil já tem `urn:ml:mktp:orders-shipments:/read-write`
  (reconectado 28/10 13:45 UTC). Outras orgs podem estar só com leitura → tratar o 403 como
  "reconecte a conta ML" e não como erro genérico.
- **Regras do projeto:** ADR novo antes de implementar (ação de escrita no ML com efeito
  financeiro); revisão humana antes de agir no marketplace; edge functions idempotentes;
  RLS por `org_id`; tokens nunca no front (toda escrita via edge function); dropdown = `Select`
  de `src/components/ui/select.tsx`; nunca editar anúncio fora do fluxo (aqui não há anúncio).
- `ml_devolucoes` é escrita pelo sync com `user_id` = dono da conexão; leitura na tela deve ser
  por `org_id` (mesma armadilha corrigida em mensagens, emenda 2026-10-20 do ADR-0067).
- Achado de 28/10: a devolução 5597930682 estava `closed` em `ml_devolucoes` e sem
  `return_status`, enquanto o ML pedia revisão — **o estado de revisão vive em
  `returns/{id}/reviews` e no `detail`, não no claim**. O sync precisa ler esses recursos para
  o card "Revisar" ser confiável.

## Decidido pelo Diego

- Organização: 3 abas igual ao ML (mockup A), não caixa única.
- Fluxo de revisar devolução: os dois caminhos do mockup, com fotos.
- Detalhe da reclamação: estado + histórico + ações liberadas pelo ML, conforme mockup.
- Prioridade: revisar devolução **e** agir em reclamação, juntos (ambos frequentes).
- **Permissão:** qualquer membro autenticado da org pode executar todas as ações (revisar,
  reembolsar, responder, abrir disputa, enviar evidência) — mesmo modelo de responder mensagens
  (ADR-0067), não o admin-only do ADR-0060. Diego escolheu isso sabendo que reembolso mexe com
  dinheiro. A edge registra quem executou cada ação (auditoria).
- **Leitura sincronizada com o ML:** abrir uma conversa no PubliAI marca as mensagens como
  lidas **também no ML** (hoje o app lê com `mark_as_read=false`). Os cards *Não lidas* /
  *Sem responder* / *Respondidas* passam a refletir o estado de leitura do ML
  (`message_date.read` das mensagens recebidas), batendo com o painel do ML. "Dispensar" segue
  existindo para tirar de *Sem responder* sem responder.

## Calls do Claude (marcadas para Diego conferir)

- **Onde fica:** as 3 abas substituem as abas Devoluções e Mensagens atuais do Faturamento por
  uma aba **Pós-venda** com as 3 sub-abas (menos abas no topo; Perguntas segue separada, como
  no ML). A tabela de devoluções atual (com período/exportação, usada para financeiro) continua
  acessível como visão "Histórico" dentro de Devoluções.
- **Confirmação:** toda ação de escrita abre uma confirmação dizendo o que acontece no ML e que
  não dá para desfazer; depois de enviar, a tela **relê** a reclamação/devolução no ML e só
  então mostra o novo estado (sem otimismo na UI).
- **Urgentes × Em andamento:** *Urgente* = a vez é do vendedor (`detail.action_responsible`
  do lado do vendedor, ou alguma `available_action` obrigatória), ordenado pelo `due_date` mais
  próximo; vencido no topo, sem prazo no fim. *Em andamento* = vez do comprador ou do ML.
  Mesma lógica do "Último dia para sua revisão" do ML.
- **Fotos:** upload direto do front para uma edge function que repassa ao ML (sem guardar a
  imagem no nosso storage), limite de tamanho/quantidade definido pela doc do ML.

## Deixado para quem constrói

- Modelo de dados: estender `ml_devolucoes` (ex.: `return_id`, `detalhe` jsonb,
  `revisao_status`, `prazo`, `vez_de`) e/ou tabela para mensagens da reclamação — decidir no ADR.
- Estratégia de sync dos recursos novos (no `sync-devolucao` por webhook + reconciliar, com
  teto de requisições por claim — hoje ~8 por claim).
- Idempotência das ações (chave por claim+ação+payload; recusar se a última leitura mostra a
  ação já feita).
- Layout fino das telas (seguir o mockup aprovado e o padrão visual do app).

## Perguntas em aberto

Nenhuma. A checagem de construtor (Codex gpt-6.1-sol, 28/10) levantou permissão, critério de
"Urgentes" e semântica de "lida"; as três estão respondidas acima.
