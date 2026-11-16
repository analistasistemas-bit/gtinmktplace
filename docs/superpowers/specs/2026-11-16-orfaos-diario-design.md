# Conferência diária de anúncios órfãos — design curto

**Data:** 2026-11-16 · **Aprovado por:** Diego (conversa) · **Classificação:** moderada

## Intenção
A conferência "Conferir anúncios com o Mercado Livre" (adendo do ADR-0088, incidente 2026-09-10) só roda
quando um admin clica. Diego quer que ela rode sozinha 1×/dia e **só avise quando houver divergência** —
e o aviso vai **só para ele, dono do SaaS**, nunca para as orgs.

## Escopo
- Divergência = classe `perdido_do_app` **sem** `provavelRemocaoPeloApp` (o grupo vermelho da tela).
  Catálogo sem vínculo, externos e "provável Remover" não avisam (são normais; virariam ruído).
- Sem divergência → nenhuma mensagem.
- Varredura parcial (`truncado`) → a mensagem diz que foi parcial.

## Não-objetivos
- Nenhuma escrita no ML nem no banco (segue somente-leitura).
- Sem tabela de "já avisados": avisa todo dia enquanto a divergência existir (escolha X do Diego).
- Sem aviso para admins das orgs; sem mudança na tela.

## Abordagens
- **A — schedule diário + 1 job QStash por org (escolhida).** Mesmo padrão do `resumo-diario` e do
  fan-out por org (ADR-0173, limite de CPU).
- B — uma execução varrendo todas as orgs em série: descartada (risco de CPU, o problema do ADR-0173).
- Repetição: **X — avisa todo dia (escolhida)**; Y — só anúncio novo: exigiria tabela + migration.

## Como
- `varrer-anuncios-orfaos` passa a aceitar dois modos, como o `monitorar-moderados`:
  - **Sem `upstash-signature`:** caminho atual (JWT do operador via `requireUserOrg`), resposta igual.
  - **Com assinatura QStash:** corpo vazio → enfileira `{ orgId }` para cada org com conexão ML
    (`deduplicationId` por org+dia); `{ orgId }` → varre a org e, se houver divergência, manda Telegram.
- `verify_jwt` da função vira `false` (JWT validado à mão pelo `requireUserOrg`, como no moderados).
- Telegram: bot e chat do dono já existentes (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_LEADS_CHAT_ID`, "Telegram
  da Daludi"). Uma mensagem por org com divergência.
- Schedule QStash `0 11 * * *` (08:00 BRT), sem body. Falha de uma org → 500 → retry do QStash.
- Montagem da mensagem e o filtro de divergência ficam numa função pura testada.

## Deixado ao implementador
Texto exato da mensagem; quais orgs contam como "com conexão ML" (reusar o que a edge já usa).
