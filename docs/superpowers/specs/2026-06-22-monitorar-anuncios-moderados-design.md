# Design — Monitoramento de anúncios moderados + alerta

**Data:** 2026-06-22
**Status:** aprovado
**ADR relacionado:** [0035-monitoramento-anuncios-moderados](../../decisions/0035-monitoramento-anuncios-moderados.md)

## Problema

Quando o Mercado Livre modera um anúncio (`status: under_review` + `sub_status` como
`forbidden`, `waiting_for_patch`, `poor_quality_thumbnail`), o anúncio sai do ar mas o
operador só descobre se abrir a tela Publicados e reparar no badge "Moderado". Não há
aviso proativo nem leitura do motivo.

Investigação na API do ML (token real, 2026-06-22) confirmou:

- O item API entrega só o **código** do sub_status (ex.: `forbidden`). Não há campo de
  texto com o motivo (`health: null`, `warnings: []`, sem campo `moderations`).
- O endpoint que teria o motivo textual (`/moderations/infractions/search`) existe mas
  retorna **401 "token not valid"** — bloqueado por permissão do app (mesma classe do
  `/orders`).
- O filtro `GET /users/{seller}/items/search?sub_status=forbidden` funciona.
- O motivo legível só aparece na Central de Notificações / e-mail do ML e no próprio
  anúncio.

## Objetivo

1. Avisar proativamente (app + Telegram) quando um anúncio entra em estado moderado.
2. Melhorar a tela Publicados para traduzir o código cru e levar ao anúncio no ML.

## Escopo do alerta

Dispara para tudo que `parseStatusML` já classifica como `status === 'moderado'`
(`forbidden`, `waiting_for_patch`, `poor_quality_thumbnail`). Não dispara para
pausa/encerramento normais.

## Arquitetura

```
QStash Schedule (cron, a cada 6h)
        │  POST assinado (upstash-signature)
        ▼
edge fn: monitorar-moderados
        │ 1. para cada ml_credentials (user):
        │ 2.   lê familias.ml_item_id desse user
        │ 3.   conn.lerStatus(ids)            ← reusa código da tela
        │ 4.   moderados = status === 'moderado' (id, motivo)
        │ 5.   diff contra tabela ml_moderacao
        │ 6.   NOVOS → Telegram  |  RECUPERADOS → resolvido_em
        ▼
   tabela ml_moderacao (estado + dedup)

App (Publicados): banner "⚠ N moderados" conta status==='moderado'
  do fetch ao vivo que a tela JÁ faz (status-publicados). Não depende
  da tabela.
```

### Componentes

**1. Edge function `monitorar-moderados`** (`supabase/functions/monitorar-moderados/index.ts`)
- Valida assinatura via `qstashReceiver()` (`_shared/queue.ts`). `verify_jwt = false`.
- Loop sobre linhas de `ml_credentials` (multi-tenant-ready; hoje 1 conta).
- Reusa `getConnector('mercado_livre').lerStatus(ctx, ids)` e `parseStatusML`.
- Nenhuma duplicação de lógica de status.

**2. Tabela `ml_moderacao`** (migration nova)
| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid | FK auth.users, RLS |
| `ml_item_id` | text | |
| `status` | text | status moderado corrente |
| `motivo` | text | sub_status cru (ex.: `forbidden`) |
| `detectado_em` | timestamptz | primeira detecção |
| `alertado_em` | timestamptz null | quando o Telegram foi enviado |
| `resolvido_em` | timestamptz null | quando saiu do estado moderado |
| `atualizado_em` | timestamptz | |
- Único por (`user_id`, `ml_item_id`) entre registros não resolvidos.
- RLS por `user_id`. Service role (worker) faz upsert.
- Diff: item moderado ainda sem linha aberta → NOVO. Item com linha aberta que não
  está mais moderado → set `resolvido_em`.

**3. Helper Telegram** (`supabase/functions/_shared/notificacoes/telegram.ts`)
- `enviarTelegram(texto: string): Promise<void>` via Bot API.
- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- Sem secret configurado → no-op com `console.warn` (não quebra o worker).
- Mensagem agrupa os novos moderados: nome/código, motivo traduzido, permalink ML.

**4. Agendamento QStash**
- Um schedule cron (a cada 6h) apontando para a URL da função, reusando `qstashClient()`.
- Criado via script/CLI de setup (documentado), não em runtime.

**5. Frontend — `src/pages/Publicados.tsx`** (2 mudanças pequenas)
- Banner no topo: `⚠ N anúncios moderados pelo ML` quando há `status==='moderado'`;
  oculto quando 0. Conta a partir do mesmo fetch ao vivo já existente.
- Tradução do motivo na lista (mapa): `forbidden→"Proibido pelo ML"`,
  `waiting_for_patch→"Aguardando correção"`, `poor_quality_thumbnail→"Foto reprovada"`,
  fallback = código cru. O botão "↗ ML" da linha já leva ao anúncio.

## Tratamento de erro

- `lerStatus` falha p/ um bloco → itens viram `indisponivel`, não `moderado` → não gera
  falso alerta. Worker não trava.
- Telegram falha → `console.warn`, segue; a tabela já registrou (alertado_em fica null e
  tentará no próximo ciclo).
- `getToken` falha (sem credencial) → pula o user.

## Testes

- `parseStatusML` já tem testes; a lógica de status é reusada, não reescrita.
- `diffModerados(correntes, abertos)` (função pura) → testes: novo, resolvido,
  inalterado, reincidente.
- Tradução de motivo: função pura testável.
- Helper Telegram: teste do formato da mensagem (sem rede).

## Fora de escopo (YAGNI)

- Webhook do ML (polling 6h basta p/ single-tenant).
- Buscar texto do motivo via API (`/moderations/infractions` bloqueado por permissão).
- Painel/histórico de moderação dedicado.
- Notificação por e-mail (Telegram + app já cobrem).
