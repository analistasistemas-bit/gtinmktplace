# ADR-0033 — Serialização das publicações no Mercado Livre (QStash Queue por usuário)

**Status:** Aceito
**Data:** 2026-06-19
**Relacionado:** [ADR-0006](0006-qstash-em-vez-de-fila-no-postgres.md) (QStash), [ADR-0012] (lock de refresh de token ML), `publish-familia-ml`, `update-familia-ml`, `publicar-familias`, `_shared/queue.ts`

## Contexto

No lote #43 Diego publicou 6 famílias; uma (`02929376`) ficou ~30 min em `publicando`,
parecendo travada. Diagnóstico (logs da edge function + eventos do QStash):

- Diego selecionou duas famílias e clicou publicar. O `publicar-familias` enfileirou as
  duas via `publishJSON`, e o QStash as entregou **em paralelo** ao `publish-familia-ml`.
- As duas baterem quase simultâneas no `POST /items` do ML fez a 2ª receber um **erro
  transitório** (rate-limit/429 ou processamento de foto assíncrono). O padrão relatado
  pelo operador — *"mando 2, o 1º vai rápido, o 2º segura"* — é consistente e reproduzível.
- O `publish-familia-ml` classifica o erro como retentável e devolve 500 mantendo
  `publicando`, relançando para o QStash. O QStash retenta com **backoff exponencial**: as 3
  primeiras tentativas falharam em ~3 min e a **4ª só veio 30 min depois** — aí, sem
  concorrência, o ML aceitou e a família publicou (`DELIVERED`).

Ou seja, não há travamento permanente, mas a concorrência entre publicações do mesmo
vendedor gera erros transitórios que o backoff transforma em dezenas de minutos de
`publicando`. A causa raiz é **disparar várias escritas concorrentes na mesma conta ML**.

## Decisão

Serializar as escritas no ML por usuário usando uma **QStash Queue com `parallelism: 1`**,
em vez de `publishJSON` (entrega paralela).

- `_shared/queue.ts`:
  - Nome da fila por usuário: `publish-ml-${userId}` (o rate-limit do ML é por conta de
    vendedor; uma fila por usuário serializa cada conta e mantém usuários distintos
    independentes — preparando o multi-tenant do ADR-0027).
  - `garantirQueueSerial(userId)`: faz `queue.upsert({ parallelism: 1 })` (idempotente).
  - `enfileirarPublicacao` e `enfileirarAtualizacao` passam a receber `userId` e usam
    `queue.enqueueJSON({ url, body, retries: 3 })`. CREATE (`publish-familia-ml`) e UPDATE
    (`update-familia-ml`) compartilham a mesma fila do usuário, pois ambos escrevem na
    mesma conta ML e não podem rodar concorrentes entre si.
- `publicar-familias/index.ts`: chama `garantirQueueSerial(user.id)` uma vez antes de
  enfileirar, e passa `user.id` nas chamadas.

O contrato do worker não muda: continua recebendo `{ familia_id, lote_id, listing_type_id }`,
validando a assinatura do QStash e com `retries: 3`. Só a **ordem/concorrência** de entrega
muda. O retry transitório continua existindo como rede de segurança, mas deixa de ser
acionado pela concorrência que nós mesmos criávamos.

## Consequências

- Acaba o gatilho do problema: as publicações de um vendedor são entregues uma por vez, sem
  baterem concorrentes no `POST /items`. Some o erro transitório recorrente e a espera de
  ~30 min em `publicando`.
- Um lote grande publica em série (cada item ~3-4s): um lote de 12 leva ~1 min — previsível,
  e muito melhor que a janela de backoff atual.
- Usuários diferentes (multi-tenant futuro) seguem em filas separadas, sem interferência.
- O número de filas cresce com o nº de usuários ativos; com o volume single-tenant atual é
  irrelevante. Reavaliar contra os limites do plano QStash quando o multi-tenant (ADR-0027)
  trouxer muitos vendedores.
- `process-familia` (pipeline de IA) **não** entra nesta serialização: não escreve item no
  ML e não foi reportado como problemático; mantido fora para a mudança ser cirúrgica.
