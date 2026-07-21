# ADR-0085 — Notificação in-app (espelho do Telegram)

**Status:** Aceito
**Data:** 2026-07-21
**Relacionado:** ADR-0036 (alerta de catálogo no-match), ADR-0068 (destinatário por profile/categoria), `_shared/notificacoes/config.ts`, `_shared/notificacoes/telegram.ts`

## Contexto

Todo alerta operacional (catálogo sem match, moderação, venda, pergunta, mensagem, devolução,
liberação de saldo, conexão ML caída) sai só por Telegram, via `notificarCategoria`. Isso depende
de o operador ter configurado bot/chat_id e estar de olho no Telegram — sem fallback dentro do
próprio app.

Investigação prévia (sessão 2026-07-20) descartou automatizar o clique de "Não encontro minha
variação" do catálogo (ADR-0036): é um endpoint interno do site do ML, sem equivalente OAuth.
Fica então a parte viável: garantir que o alerta chegue também **dentro do app**, com o mesmo
link direto que já vai na mensagem do Telegram, para quem não usa Telegram ou não estava olhando
o celular no momento.

## Decisão

Nova tabela `notificacoes` (in-app), escrita pelo mesmo ponto único que já dispara o Telegram:
`notificarCategoria` (`_shared/notificacoes/config.ts`). Zero mudança nos 10 call-sites
existentes (`vincular-catalogo`, `monitorar-moderados`, `notificar-liberacao`,
`reconciliar-faturamento`, `sync-devolucao`, `sync-mensagem`, `sync-pergunta`, `sync-venda`) —
todos os alertas passam a ter espelho in-app automaticamente.

**Quem recebe:** os mesmos assinantes da categoria (`profiles.telegram_categorias`, ADR-0068),
mas **sem exigir Telegram configurado** — a assinatura de categoria passa a valer para os dois
canais. Reusar a mesma lista de assinantes evita criar uma segunda tela de preferências para uma
funcionalidade que é, na prática, "avise-me sobre X"; o canal (Telegram vs. in-app) é detalhe de
entrega, não de intenção do usuário.

**Conteúdo:** grava o mesmo `texto` (string já formatada) que vai para o Telegram, incluindo o
link — sem template separado. Simplicidade: um único lugar formata a mensagem
(`_shared/notificacoes/telegram.ts`, `montarMensagem*`).

**Entrega no front:** sino no topbar (`useQuery` com `staleTime: 60s`, mesmo padrão de
`usePerguntasNaoRespondidas`/`useMensagensAguardando` — sem realtime, não há precedente no
repo). Badge de não lidas; abrir o dropdown marca todas como lidas (RPC `security definer`, mesmo
padrão de `marcar_mensagens_lidas`).

### Modelo de dados (migration aditiva)

`notificacoes(id, user_id, org_id, categoria, texto, lida, criada_em)` — RLS `select own`
(`user_id = auth.uid()`), escrita só do worker (service role bypassa RLS), mesmo padrão de
`ml_mensagens` (ADR-0067). RPC `marcar_notificacoes_lidas(p_ids uuid[] default null)`.

## Consequências

- Todo alerta futuro que passar por `notificarCategoria` já sai espelhado in-app — sem trabalho
  extra por categoria.
- Quem nunca configurou Telegram mas assinou categorias (se isso um dia for possível pela UI)
  passa a receber in-app; hoje a tela de Usuários só existe para configurar Telegram, então na
  prática os destinatários continuam sendo quem já assina Telegram.
- Falha de insert in-app é best-effort — não derruba o envio por Telegram (nem vice-versa).
- **Fora de escopo:** comando de reassociação sob demanda e automação do "não encontro minha
  variação" — descartados na investigação (ADR-0036); o alerta só dispara quando o estado já é
  terminal, então reprocessar manualmente tem valor estreito.
