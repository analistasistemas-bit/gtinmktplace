# Runbook — Monitoramento de anúncios moderados

Operação do alerta de anúncios moderados pelo ML (ADR-0035). A função
`monitorar-moderados` relê o status dos itens publicados, faz diff contra a tabela
`ml_moderacao` e avisa os **novos** moderados no Telegram. O app mostra banner + motivo
traduzido independentemente do Telegram.

## 1. Configurar o Telegram (gera os 2 secrets)

**Bot (`TELEGRAM_BOT_TOKEN`):**
1. No Telegram, abra **@BotFather** → `/newbot`.
2. Informe nome (ex.: "PubliAI Alertas") e username terminando em `bot`.
3. Copie o token retornado (ex.: `8123456789:AAH...`).

**Chat (`TELEGRAM_CHAT_ID`):**
1. Abra conversa com o **bot novo** e mande qualquer mensagem (obrigatório — o bot não
   escreve primeiro sem isso).
2. Acesse `https://api.telegram.org/bot<TOKEN>/getUpdates` no navegador.
3. Pegue `chat.id` no JSON. (Para grupo: crie o grupo, adicione o bot, mande msg; o
   `chat.id` vem negativo, tipo `-100...`.)

## 2. Secrets no Supabase

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_CHAT_ID=<chat_id>
```

Sem esses secrets a função roda normal, só **não envia Telegram** (no-op com warning). O
banner do app e o registro em `ml_moderacao` funcionam mesmo assim.

## 3. Deploy da função

```bash
supabase functions deploy monitorar-moderados --no-verify-jwt
```

`verify_jwt = false` porque quem chama é o QStash; a autenticidade é garantida pela
assinatura (`verificarAssinatura` / `QSTASH_CURRENT_SIGNING_KEY`).

## 4. Agendamento (QStash Schedule, a cada 6h)

Criar um schedule cron `0 */6 * * *` apontando para:

```
https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/monitorar-moderados
```

Pelo painel do QStash (Schedules → Create) ou via API. O publish do QStash já assina a
requisição (header `upstash-signature`), que a função valida.

## 5. Teste ponta-a-ponta

1. Disparar o schedule manualmente (ou um publish único do QStash).
2. Resposta esperada: `{ "ok": true, "novos": N }`.
3. Telegram recebe a mensagem dos moderados atuais (na 1ª execução, todos os moderados
   existentes contam como "novos").
4. `select * from ml_moderacao` → linhas abertas com `alertado_em` preenchido.
5. Rodar de novo → `novos: 0` (dedup via índice único parcial + `diffModerados`).

## Operação / troubleshooting

- **Item saiu da moderação:** na execução seguinte, `resolvido_em` é preenchido; não
  reaparece como novo se voltar a moderar só após resolver (gera novo registro).
- **Não chegou Telegram mas tem moderado:** ver logs da função (`console.warn` de
  Telegram). `alertado_em` fica null e a função tenta de novo no próximo ciclo.
- **Falso silêncio:** se `lerStatus` falha para um bloco, os itens viram `indisponivel`
  (não `moderado`) — não gera alerta; é transitório, resolve no próximo ciclo.
- **Motivo textual:** a API do ML não expõe o texto; o link no alerta leva ao anúncio,
  onde está a notificação completa do ML.
