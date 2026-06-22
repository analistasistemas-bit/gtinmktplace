# Runbook — Monitoramento de anúncios moderados

Operação do alerta de anúncios moderados pelo ML (ADR-0035). A função
`monitorar-moderados` relê o status dos itens publicados, faz diff contra a tabela
`ml_moderacao` e avisa os **novos** moderados no Telegram. O app mostra banner + motivo
traduzido independentemente do Telegram.

## 1. Configurar o Telegram — pela tela de Configurações (não usa secrets)

As credenciais ficam na tabela `configuracoes` (por usuário, RLS), editáveis na UI em
**Configurações → Alertas no Telegram**. Nada de `supabase secrets`.

**Bot token:** no Telegram, fale com **@BotFather** → `/newbot` → nome + username `*bot`
→ copie o token (`8123456789:AAH...`).

**Chat ID:** mande uma mensagem ao bot novo, abra
`https://api.telegram.org/bot<TOKEN>/getUpdates` e copie `chat.id` (grupo: adicione o bot
ao grupo, o id vem negativo `-100...`).

Na tela: cole **Chat ID** + **Bot token**, ligue o switch **Ativo** e clique **Enviar
teste** (confirma que chegou). **Verificar agora** roda o monitor na hora. O token é
write-only (a UI mostra só "configurado ✓", nunca devolve o valor).

Sem credenciais ou com o switch desligado, a função roda normal e só **não envia
Telegram**; o banner do app e o registro em `ml_moderacao` seguem funcionando.

## 2. Deploy da função (one-time)

```bash
supabase functions deploy monitorar-moderados --no-verify-jwt
```

`verify_jwt = false` porque quem chama é o QStash; a autenticidade é garantida pela
assinatura (`verificarAssinatura` / `QSTASH_CURRENT_SIGNING_KEY`). Os botões da tela
(Enviar teste / Verificar agora) chamam a mesma função autenticados por JWT do usuário.

## 3. Agendamento (QStash Schedule, a cada 6h — one-time)

Criar um schedule cron `0 */6 * * *` apontando para:

```
https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/monitorar-moderados
```

Pelo painel do QStash (Schedules → Create) ou via API. O publish do QStash já assina a
requisição (header `upstash-signature`), que a função valida.

## 4. Teste ponta-a-ponta

1. Pela tela (Verificar agora), disparar o schedule manualmente, ou um publish único do QStash.
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
