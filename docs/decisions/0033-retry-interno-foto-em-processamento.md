# ADR-0033 — Foto em processamento no ML: parar de re-subir no retry + retry interno

**Status:** Aceito
**Data:** 2026-06-19
**Relacionado:** [ADR-0005](0005-lifecycle-publish-update.md) (lifecycle), [ADR-0006](0006-qstash-em-vez-de-fila-no-postgres.md) (QStash), `publish-familia-ml`, `_shared/publicacao/retry.ts`, commits `075a774` (tratamento original) e `9757b43` (A4, a regressão)

## Contexto

Famílias passaram a ficar **muito tempo** em `publicando` (parecendo travadas) e às vezes
caindo em `erro`. Diego: *"sempre foi rápido essa publicação, não entendo essa sequência de
erro"*. A frase é a chave — **é uma regressão**, não comportamento intrínseco.

O ML processa as fotos de forma **assíncrona**: o worker sobe a foto (`POST /pictures` →
`picture_id`) e cria o item (`POST /items`) em seguida; se a foto ainda não terminou de
processar, o ML rejeita com `item.pictures.unavailable` / "Ocorreu um erro ao processar a
foto. Por favor, envie-a novamente." (status 400, transitório). Isso **sempre existiu** (já
tratado no commit `075a774`, Lote #28).

**A regressão (causa raiz), encontrada por git:** o commit `9757b43` (achado A4 da auditoria
E1-E4, 15/jun) introduziu `limparFotosCachePublicacao` no tratamento do erro de foto — a cada
retry ele **zerava os `picture_id` e re-subia a foto**. Como o re-upload usa **a mesma imagem
do storage**, ele não conserta foto ruim alguma; só faz o ML **reiniciar o processamento do
zero a cada tentativa**, de modo que a foto **nunca assenta** e o item nunca publica.

- Antes de `9757b43`: erro de foto → 500 → QStash retenta **reusando o mesmo `picture_id`** →
  a foto (já enviada) termina de processar → publica rápido. **"Sempre foi rápido."**
- Depois de `9757b43`: erro de foto → re-sobe foto nova a cada retry → processamento reinicia
  → ciclo de `item.pictures.unavailable` → minutos em `publicando` ou `erro`.

## Decisão

1. **Remover `limparFotosCachePublicacao`** do tratamento de erro de foto (revertendo a
   regressão do A4). O retry — interno e do QStash — passa a reusar o **mesmo `picture_id`**,
   deixando o ML terminar de processar a foto já enviada. Preserva o que o A4 trouxe de bom:
   mensagem recuperável ao operador (`mensagemErroFotoRecuperavel`) e `decidirErroCriarAnuncio`
   (`_shared/publicacao/retry.ts`).
2. **Retry interno rápido** no `publish-familia-ml`: ao receber `codigo='FOTO'`, espera ~4s e
   re-tenta o `POST /items` na mesma execução (até 3×, `FOTO_RETRY_TENTATIVAS`/
   `FOTO_RETRY_INTERVALO_MS`), reusando o `picture_id`. Faz a maioria publicar em segundos na
   primeira invocação, sem nem chegar ao retry do QStash.

## Consequências

- Restaura o comportamento rápido anterior à regressão e ainda reduz latência no caso comum.
- Foto genuinamente inválida: não há mais re-upload inútil; esgota os retries e marca `erro`
  com mensagem clara (igual antes, sem o ciclo prejudicial).
- `POST /items` só cria quando aceito e o loop para no primeiro sucesso — sem risco de anúncio
  duplicado.
- Lição: o achado A4 assumiu que "re-subir foto fresca" ajudaria; como o storage_path é o
  mesmo, o re-upload nunca muda a imagem — só reinicia o relógio do ML. Tratar
  `item.pictures.unavailable` como "aguardar a mesma foto processar", não como "reenviar".

## Tentativa descartada

Hipótese inicial de concorrência → serialização via QStash Queue `parallelism=1` (PR #1).
Descartada: o erro ocorre com publicação isolada e a serialização bloqueava a 2ª família atrás
da 1ª. Revertida em produção antes desta correção.
