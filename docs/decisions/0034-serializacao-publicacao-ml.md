# ADR-0034 — Serialização das publicações no Mercado Livre (QStash Queue por usuário)

**Status:** Aceito
**Data:** 2026-06-20
**Relacionado:** [ADR-0033](0033-retry-interno-foto-em-processamento.md) (foto em processamento), [ADR-0006](0006-qstash-em-vez-de-fila-no-postgres.md) (QStash), `publicar-familias`, `_shared/queue.ts`

## Contexto

Depois de corrigir o loop de re-upload de foto (ADR-0033), publicar **vários produtos juntos**
ainda ficava lento e às vezes caía em `erro`. Investigação com teste controlado mostrou a
causa: **concorrência**. Quando duas famílias são publicadas em paralelo, as duas fotos sobem
quase simultâneas ao ML e o **processamento assíncrono de imagem do ML fica muito mais lento**
— passa dos ~12s do retry interno do worker e estoura as tentativas.

Prova (Lote #43): as famílias `02929210` e `02929414`, publicadas **em par**, falharam em loop
(`item.pictures.unavailable`) e viraram `erro` em ~1 min. As **mesmas** famílias, reenviadas
**isoladas**, publicaram em **3-4 segundos** cada, na primeira tentativa.

Uma tentativa anterior de serializar (PR #1) foi descartada porque, naquele momento, o bug do
re-upload (ADR-0033) ainda existia — cada família travava, serializada ou não, e a serialização
só somava o bloqueio em cadeia. **A ordem importava:** corrigir o re-upload primeiro (ADR-0033),
depois serializar.

## Decisão

Serializar as escritas no ML por usuário com uma **QStash Queue `parallelism: 1`**
(`publish-ml-${userId}`), em vez de `publishJSON` (entrega paralela).

- `_shared/queue.ts`: `garantirFilaSerial(userId)` faz `queue.upsert({ parallelism: 1 })`;
  `enfileirarPublicacao`/`enfileirarAtualizacao` recebem `userId` e usam `queue.enqueueJSON`.
  CREATE (`publish-familia-ml`) e UPDATE (`update-familia-ml`) compartilham a fila do usuário —
  ambos escrevem na mesma conta ML e não podem rodar concorrentes.
- `publicar-familias`: chama `garantirFilaSerial(user.id)` antes de enfileirar e passa `user.id`.
- `retries: 3` (alinhado ao `MAX_RETRIES_TRANSIENTES` do worker) + `retryDelay: '10000'` ficam
  como **rede de segurança** para um erro transiente de foto isolado; com a fila serial, a
  concorrência some e o retry raramente dispara.

## Consequências

- Sem concorrência, cada publicação processa a foto em segundos (como isolada) e publica de
  primeira. Vários produtos saem em série, ~segundos cada (ex.: 12 itens em ~1 min), de forma
  confiável, em vez de travar.
- Usuários diferentes seguem em filas separadas (preparado p/ multi-tenant, ADR-0027).
- O nº de filas cresce com usuários ativos — irrelevante no volume single-tenant atual;
  reavaliar contra limites do plano QStash quando houver muitos vendedores.
- `process-familia` (pipeline de IA) fica fora: não escreve item no ML.
