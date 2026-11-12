# Galeria da cor — envio de fotos em lote (plano)

ADR: adendo (k) em `docs/decisions/0201-galeria-da-cor-por-ia.md`. Só código de edge compartilhado; **sem migration, sem mudança de tela**.

## Diagnóstico (arquivo:linha)
- `saga.ts:264-293` (`passo === 'subir'`): UMA foto por execução; ao fim `gravar({fase: fase+1}, true)` solta lease e zera `publicado_em`.
- `saga.ts:158-159`/`gravar`: `publicado_em = null` ⇒ só o despachante re-publica (`despacho.ts:65-67`, `itemAcionavel`), tick de 1 min (ADR-0201 (f)).
- `saga.ts:4-5`/`galeria-aplicar-worker/index.ts:4`: "Nunca publica nada".
- Cronologia 12/11 (1 anúncio, 7 fotos): 8 mensagens (7 uploads + 1 PUT; a "consulta de prontas" `saga.ts:266-272` não roda porque o upload já volta `pronta`). A 1ª sai na hora (`galeria-aplicar/index.ts:140`), as outras 7 esperam 1 tick ⇒ 7 min.
- Fila serial por usuário: `queue.ts:12` (`parallelism: 1`), `despacho.ts:126` (`queueName: publish-ml-<user>`). Itens de uma mesma aplicação são publicados juntos mas executam em série.
- Prazo: `20261109093335_galeria_da_cor.sql:548` (`now() + 30 min`); ciclo 3 h (`:549`). Cota do despachante: 20 itens por tick (`despacho.ts:11`).
- Lease 150 s (`saga.ts:21`); upload POST: timeout 30 s (`ml/fotos.ts:31`), ~1 s medido (ensaio da Task 1). Edge: 2 s de CPU (ADR-0173).

## Escolha: A (laço de fotos no lease). Não B, não C agora
- B (worker publica a próxima fase): reabre "nunca publica", repete claim + 3 leituras + token por foto, e na fila serial só intercala os itens. Sem ganho de vazão.
- C (prazo proporcional): precisa de migration; vazão serial ≈ N×25 s ⇒ 30 min comporta ~70 anúncios. Adiada (ADR (k)).

## Mudança (um arquivo de produção: `saga.ts`)
1. `export const ORCAMENTO_SUBIDA_MS = 60_000`.
2. No ramo `subir`, quando existe foto sem `upload_id`: laço.
   - antes de cada foto depois da 1ª: para se `agora - inicio >= ORCAMENTO_SUBIDA_MS` ou `portaoFechado(aplicacao, {agora, vigente})`.
   - por foto: baixa + confere sha (falha ⇒ `concluir('falhou')`), grava `enviando` (`status:'subindo'`, **sem soltar**), POST, grava `upload_id`/`pronta` (**sem soltar**). Gravação recusada (posse anulada) ⇒ `perdeu_posse`.
   - fim do laço: `gravar({fase: fase+1}, true)` (uma vez) ⇒ `'subiu'`.
3. Ramo "todas enviadas, falta pronta" (`i < 0`) e o PUT: inalterados.
4. Comentários de cabeçalho de `saga.ts` e do worker; `docs/reference/edge-functions.md` se citar "uma foto por fase".

## Testes (TDD, `saga.test.ts`; vermelho antes)
1. 7 fotos, 1 mensagem ⇒ 7 uploads, `fase` +1, 0 PUT; 2ª mensagem ⇒ PUT único, aplicado (cenário 12/11 em 2 mensagens).
2. Queda no meio (exceção na gravação após a 3ª foto) ⇒ nova execução depois do lease sobe só as 4 restantes; total 7 uploads, ids sem repetição.
3. Queda com `enviando` e sem id ⇒ `falhou: upload_incerto`, nenhum re-upload (existente, mantido).
4. Duas mensagens concorrentes do mesmo item (2ª dispara dentro do `subir` da 1ª) ⇒ 2ª `ocupado`, 0 upload extra; e mensagem repetida depois do fim ⇒ fase velha, `ocupado`.
5. Prazo vence no meio do laço (relógio avança no upload) ⇒ laço para, 0 PUT; próxima mensagem `pulado: prazo_vencido`, aplicação aborta/compensa.
6. Orçamento de 60 s estourado ⇒ para com fotos restantes, `fase` +1; próxima mensagem continua; PUT só com todas enviadas e prontas.
7. Aborto por outro item no meio (posse anulada) ⇒ laço para na gravação seguinte, `perdeu_posse`, sem novo upload.
8. Aplicar (laço) + desfazer ⇒ `revertida` com fotos originais, 0 PUT extra de ida.
9. Progresso: `fotos_enviadas` (contagem de `pronta`) sobe foto a foto dentro do laço.

## Portão
`pnpm exec vitest run supabase/functions/_shared/galeria/__tests__/saga.test.ts`, suíte `galeria`, `pnpm preflight`; scripts SQL de concorrência (`scripts/sql/teste-galeria-saga.sql`, `supabase/tests/galeria_*.sql`) rodados e verdes (SQL inalterado). Revisão do diff: Grok 4.7 high; pré-merge: idem; CI verde. **Sem deploy e sem teste em anúncio real sem OK do Diego.**
