# ADR-0033 — Retry interno para foto em processamento no POST /items (ML)

**Status:** Aceito
**Data:** 2026-06-19
**Relacionado:** [ADR-0005](0005-lifecycle-publish-update.md) (lifecycle), [ADR-0006](0006-qstash-em-vez-de-fila-no-postgres.md) (QStash), `publish-familia-ml`, `_shared/ml/criar-item.ts`, `_shared/ml/erro-ml.ts`

## Contexto

Famílias ficavam minutos em `publicando` (parecendo travadas) e publicavam sozinhas depois.
Diego percebeu como "mando 2 produtos, o 2º trava".

Investigação (logs de console do `publish-familia-ml` via Analytics API) mostrou a causa
exata. O ML processa as fotos de forma **assíncrona**: o worker sobe a foto
(`POST /pictures` → `picture_id`) e cria o item (`POST /items`) logo em seguida; enquanto a
foto não termina de processar, o ML rejeita o item com:

```json
{"cause":[{"code":"item.pictures.unavailable",
  "message":"Ocorreu um erro ao processar a foto. Por favor, envie-a novamente."}],
 "message":"Validation error","status":400}
```

É um **400 transitório** que `ehErroRetentavel` classifica como retentável (`codigo='FOTO'`).
O worker devolvia 500 e o QStash retentava com **backoff exponencial** — a tentativa seguinte
(já com a foto processada) publicava, mas só depois de minutos. O erro é **intermitente e
independe de concorrência** (ocorre com uma publicação isolada). Uma tentativa anterior de
serializar as publicações (QStash Queue `parallelism=1`) foi **descartada**: não resolvia e
ainda fazia a 2ª família esperar todos os retries da 1ª.

## Decisão

Retry interno rápido no `publish-familia-ml`: quando `criarAnuncio` falha com `codigo='FOTO'`
(foto ainda em processamento), o worker **espera poucos segundos e re-tenta o `POST /items`
na mesma execução**, reusando os `picture_id` já enviados — sem limpar o cache de fotos.

- `FOTO_RETRY_TENTATIVAS = 3`, `FOTO_RETRY_INTERVALO_MS = 4000` (até ~12s de espera + 3
  chamadas, dentro do limite de wall-clock da edge function).
- Só o caminho de foto entra no retry interno; 429/5xx (`DESCONHECIDO`) seguem o fluxo atual.
- Se o retry interno esgotar, cai no tratamento existente (limpa cache de fotos + 500 para o
  QStash retentar com foto fresca, ou marca `erro` se for definitivo) — a rede de segurança
  do backoff continua, mas deixa de ser o caminho comum.

## Consequências

- A grande maioria das publicações que hoje "travam" por foto em processamento passa a
  resolver em segundos, na primeira execução, sem o item ficar minutos em `publicando`.
- Custo: nos casos de foto não-processada, +1 a +3 `POST /items` (e os `GET` de schema que
  `criarAnuncio` faz) por publicação, espaçados por 4s. Aceitável para o volume atual.
- Não altera contrato nem idempotência: `POST /items` só cria quando aceito; o loop para no
  primeiro sucesso, então não há risco de anúncio duplicado.
- O backoff do QStash permanece como rede de segurança para falhas que persistam além de ~12s.
