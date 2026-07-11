# ADR-0067 — Notificações Telegram por destinatário e categoria

**Data:** 2026-07-11
**Status:** aceito
**Relaciona:** [ADR-0027](0027-multi-tenancy-organizations.md), [ADR-0035](0035-alerta-moderacao-telegram.md), [ADR-0037](0037-modulo-faturamento-webhooks-ml.md), [ADR-0047](0047-operacao-compartilhada-rbac-menu.md)

## Contexto

Até aqui o Telegram tinha **um único destino por organização**: `configuracoes.telegram_chat_id`
(um bot + um chat, ADR-0035). Todos os eventos — nova venda, pergunta, devolução, moderação,
liberação de saldo, catálogo sem match — caíam nesse mesmo chat. Na prática, só o super-admin
(Diego) recebia tudo.

Necessidade: permitir que o admin escolha **quais usuários cadastrados** recebem notificações e
**quais tipos** cada um recebe (vendas, perguntas, pós-venda, financeiro, moderação).

Restrição técnica decisiva: um bot do Telegram **não pode iniciar conversa** — a pessoa precisa
falar com o bot antes de poder receber. Capturar o `chat_id` de cada destinatário via fluxo
self-service exigiria uma edge function nova que *recebe* updates do Telegram (`setWebhook`), que
hoje não existe (o bot só envia).

## Decisão

**1. Destino por profile, bot por org.** O bot (token) continua único por organização em
`configuracoes` (`telegram_bot_token`, `telegram_ativo` como interruptor-mestre). O que passa a ser
por pessoa é o **destino** e as **assinaturas**: duas colunas novas em `profiles` —
`telegram_chat_id text` e `telegram_categorias text[]` (CHECK contra as 5 categorias conhecidas).

**2. Cinco categorias** como eixo de assinatura, agrupando os 6 eventos técnicos:
`vendas` (nova venda), `perguntas` (pergunta de comprador), `pos_venda` (devolução/reclamação),
`financeiro` (liberação de saldo MP), `moderacao` (anúncio moderado **e** catálogo sem match).
Fonte canônica em `_shared/notificacoes/categorias.ts`, espelhada no front
(`src/lib/notificacoes-categorias.ts`) — Deno e front não compartilham módulo.

**3. `chat_id` colado manualmente**, não self-service. O admin informa o `chat_id` de cada pessoa
(obtido via `@userinfobot`) na tela de Usuários. Trade-off explícito: evita criar a edge function
receptora de webhook do Telegram + `setWebhook`. Custo: passo manual por destinatário.

**4. Gestão só por admin**, na tela **Usuários** (`/usuarios`, já admin-only por ADR-0047), via a
edge function `usuarios` (nova ação `update_notificacoes`, que valida admin/mesma-org e sanitiza a
entrada). Não em Configurações, que é visível a não-admins. Cada linha da tabela de usuários mostra
as categorias assinadas e um dialog "Notificações" para editar `chat_id` + categorias.

**5. Envio centralizado.** `notificarCategoria(admin, orgId, categoria, texto)` em
`_shared/notificacoes/config.ts` resolve os destinatários (profiles ativos da org que assinam a
categoria e têm `chat_id`, com o interruptor-mestre ligado) e envia a cada um (best-effort). Os 6
call sites passaram a chamá-la com sua categoria, em vez de `lerConfigTelegram` + `enviarTelegram`.

**6. Continuidade.** Migration faz backfill preservando quem recebe hoje: o `chat_id` da config
ativa (`configuracoes.user_id` → profile correspondente) vira o destino desse profile com **todas**
as categorias ligadas. Verificado read-only antes do deploy: a única org com Telegram ativo resolve
corretamente. O campo de `chat_id` em Configurações passa a ser só "teste de conexão" + seed legado
(relabelado na UI para não induzir o operador a achar que é ele quem define o destino).

## Consequências

- `profiles` ganha estado de notificação; RLS existente (admin edita profiles da própria org) já
  cobre. A gravação passa pela edge function `usuarios` (service role + checagem de admin/org).
- `vincular-catalogo`, que lia a config Telegram inline por `user_id` (legado, divergente do resto),
  passou a usar `notificarCategoria` por `org_id` — corrige o desalinhamento de brinde.
- Um evento cuja categoria ninguém assina simplesmente não envia. Orgs cujo `configuracoes.user_id`
  não resolva ficam sem destinatário até o admin configurar na tela Usuários.
- Não há fluxo self-service de vínculo do Telegram — decisão reversível no futuro (criar a edge
  function receptora) sem mudar o modelo de dados.
