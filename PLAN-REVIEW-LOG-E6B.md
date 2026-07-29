# Plan Review Log: E6b — Cadastro manual + Entrada + Estoque único cross-canal

Started 2026-07-28. MAX_ROUNDS=5. Modelo do crítico: `gpt-5.6-sol`, `model_reasoning_effort=medium`.

Plano em revisão: `PLAN-E6B.md` (resumo) + `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md` +
`docs/superpowers/plans/2026-07-28-e6b-b-cadastro-e-entrada.md` (planos detalhados) +
`docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md` (spec).

## Round 1 — Codex (gpt-5.6-sol, effort medium)

O plano ainda tem problemas materiais de idempotência, autorização e integridade de estoque.

## Findings

### Banco e concorrência

1. **BLOCKER — As RPCs podem ficar inexecutáveis pelo `service_role`.**  
   Plano: `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md:414-419` revoga `EXECUTE` de `PUBLIC` e não concede ao `service_role`.  
   Código real: `supabase/migrations/20260723215424_adr88_reconciliacao_tentativas.sql:80-81` mostra o padrão correto: revogar e depois `grant execute ... to service_role`.  
   **Fix:** adicionar `grant execute` explícito das três RPCs ao `service_role`.

2. **HIGH — A idempotência desaparece quando `p_ref` é nulo.**  
   Plano: `...e6b-a-estoque.md:214-230` e `:270-285` não validam `p_ref`; o índice em `:192-195` exclui referências nulas.  
   Código real: não existe unique org-wide alternativa em `variacoes`; `supabase/migrations/20260527125643_familias_variacoes.sql:86-122` só garante `(familia_id,codigo)`.  
   **Fix:** rejeitar `p_ref is null or btrim(p_ref)=''` em baixa e estorno, como já é feito em `registrar_entrada`.

3. **BLOCKER — “Toda escrita passa pela edge” é falso: qualquer usuário autenticado pode atualizar `variacoes.estoque` diretamente.**  
   Plano: `...e6b-a-estoque.md:383-412` usa `auth.uid()` para aceitar justamente essa escrita direta, contrariando a restrição global em `:20`.  
   Código real: `supabase/migrations/20260705165828_e7_rls_org.sql:13-21` concede UPDATE completo em `variacoes` a qualquer membro da org. Isso também contorna o gate pago da edge e não enfileira push.  
   **Fix:** bloquear UPDATE direto da coluna `estoque` e criar uma edge/RPC autorizada para ajuste manual, com ledger e enqueue no mesmo fluxo.

4. **HIGH — O estorno é um check-then-act não atômico e usa a quantidade atual do pedido.**  
   Plano: `...e6b-a-estoque.md:1427-1440` faz `houveBaixa()` e depois chama outra RPC usando `selecionarBaixas(itens)`.  
   Código real: `supabase/functions/_shared/faturamento/io.ts:226-270` faz SELECT anterior seguido de UPSERT sem lock; sincronizações paid/cancelled podem intercalar. O snapshot cancelado também pode ter itens diferentes do movimento original.  
   **Fix:** uma única RPC deve localizar/travar o movimento `venda`, usar `abs(quantidade)` dele e inserir/aplicar o estorno atomicamente.

5. **HIGH — SKU não é validado como único na org, mas as RPCs o tratam como identidade global.**  
   Plano: `...e6b-b-cadastro-e-entrada.md:677-686` só detecta repetição dentro do formulário; `:832-848` protege apenas `codigo_pai`. As RPCs escolhem a variação mais recente apenas por `(org_id,codigo)` em `...e6b-a-estoque.md:233-239` e `:342-347`.  
   Código real: `supabase/migrations/20260527125643_familias_variacoes.sql:122` só possui unique `(familia_id,codigo)`; o parser da planilha deduplica apenas dentro de um arquivo em `supabase/functions/_shared/parser.ts:36-46`.  
   **Fix:** impedir SKU manual já usado por outro produto da org sob lock/transação; sem isso uma venda pode baixar o produto errado.

O bloco `EXCEPTION WHEN unique_violation` não aborta a transação externa: ele cria uma subtransação PL/pgSQL e retorna normalmente. Também não encontrei referência quebrada por `search_path=''`: tabelas, `auth.uid()` e `current_org_id()` estão qualificadas; built-ins continuam disponíveis. A unique parcial funciona como esperado quando a referência é não nula.

### Retry e idempotência ponta a ponta

6. **BLOCKER — Um retry do QStash não retoma uma baixa que falhou parcialmente.**  
   Plano: o gancho só roda sob `novaPaga` em `...e6b-a-estoque.md:1374-1410`, embora o comentário diga que o retry reexecuta o bloco.  
   Código real: `supabase/functions/_shared/faturamento/io.ts:223-270` persiste `paid` antes de calcular `novaPaga`; na segunda execução ela será falsa. `sync-venda/index.ts:128-133` confirma explicitamente esse comportamento no retry 502. Uma falha após baixar um SKU, antes dos demais ou antes do enqueue, torna-se permanente.  
   **Fix:** persistir um estado/outbox de processamento de estoque por pedido e retomar referências/jobs ausentes independentemente de `novaPaga`.

7. **HIGH — Concorrência e cancelamentos duplicam jobs de sincronização.**  
   Plano: `registrarBaixaVenda` relê movimentos existentes em `...e6b-a-estoque.md:828-845`; qualquer execução concorrente obtém os mesmos `paisAfetados` e enfileira novamente em `:1379-1383`. O estorno adiciona a ref antes de saber se a RPC inseriu algo novo em `:1427-1449`.  
   Código real: `upsertVenda` continua suscetível a duas execuções lerem o mesmo estado anterior em `io.ts:226-245`; a deduplicação existente cobre apenas notificações (`notificacoes-dedupe.ts:6-24`).  
   **Fix:** criar outbox unique por evento/produto e enfileirar apenas quando o movimento/outbox foi inserido nesta execução.

8. **HIGH — Falha ao ler shipment é interpretada como “não despachado” e pode criar estoque fantasma.**  
   Plano: `...e6b-a-estoque.md:1422-1425` considera `shipment=null` como pré-despacho e estorna.  
   Código real: `supabase/functions/_shared/faturamento/io.ts:139-163` retorna `null` em qualquer HTTP não-OK ou exceção de rede, inclusive para pedido já despachado.  
   **Fix:** repor somente com status pré-despacho explicitamente conhecido; status nulo/desconhecido deve falhar fechado, notificar e ser reavaliado.

9. **HIGH — Retry da entrada não retoma um enqueue que falhou.**  
   Plano: após entrada aplicada, o enqueue ocorre em `...e6b-b-cadastro-e-entrada.md:1015-1028`; na repetição idempotente a edge retorna antes em `:1007-1013`.  
   Evidência real: a fila não oferece outbox local; `supabase/functions/_shared/queue.ts:64-90` publica diretamente no QStash.  
   **Fix:** no caminho duplicado, localizar o movimento pela referência exata e reenfileirar de forma deduplicada, ou gravar movimento+outbox atomicamente.

As entidades novas passadas a `reservarNotificacao` são aceitas: `ml_notificacoes_enviadas.entidade` é texto sem check em `20260722111636_ml_notificacoes_enviadas_dedupe.sql:7-14`. `notificarCategoria` tem enum fechado, mas o plano usa apenas `vendas` e `pos_venda`, ambos válidos em `_shared/notificacoes/categorias.ts:5-13`.

### Escopo real do `sync-venda` e cancelamento

10. **HIGH — O código proposto não verifica erros na releitura do ledger.**  
    Plano: `...e6b-a-estoque.md:830-845` ignora `error` no SELECT de movimentos. Se a leitura falhar, devolve listas vazias, não enfileira e não notifica; `novaPaga` não volta no retry.  
    Evidência real: o projeto trata erro de Supabase explicitamente no caminho crítico, por exemplo `upsertVenda` em `supabase/functions/_shared/faturamento/io.ts:244-266`.  
    **Fix:** tratar o erro da releitura como falha durável/reprocessável, não como resultado vazio.

Os identificadores pedidos estão em escopo no ponto indicado: `admin`, `orgId`, `userId`, `pedido`, `itens` e `shipment` existem em `sync-venda/index.ts:53-98`; `reservarNotificacao` e `notificarCategoria` já estão importados em `:12-14`.

### Alvos de push, split e User Products

11. **HIGH — O worker “cross-channel” resolve token de todos os canais com código específico do Mercado Livre.**  
    Plano: `...e6b-a-estoque.md:1291-1301` chama `getValidAccessTokenConexao` para qualquer `alvo.canal`.  
    Código real: `supabase/functions/_shared/ml/token.ts:95-110` implementa refresh token rotativo exclusivo do ML; o contrato ainda só admite `CanalId='mercado_livre'` em `_shared/canais/contrato.ts:28-29`.  
    **Fix:** mover a construção/autenticação do `ContextoCanal` para o conector ou para um resolvedor por canal.

12. **MEDIUM — A alegação de cobertura “split + UP” testa um estado que o pipeline real ainda não cria.**  
    Plano: `...e6b-a-estoque.md:1064-1094` e `:1828` apresentam split e UP como cobertos.  
    Código real: `_shared/user-products/publicar-familia-up.ts:54-60` declara que o worker UP só publica partição 0 e que `publicar-split-ml` ainda não integra a saga UP.  
    **Fix:** descrever o resolvedor como forward-compatible e não como fluxo validado; adicionar o teste real quando split integrar UP.

Para as formas hoje existentes, a leitura das tabelas está coerente: `anuncios_externos_itens` realmente contém `anuncio_externo_id`, `org_id`, `sku`, `retirado`, `status` e `item_externo_id` em `20260722145236_adr88_user_products_itens_e_formato.sql:38-69`; pai UP publicado mantém `item_externo_id=null` em `_shared/user-products/publicar-familia-up.ts:117-126`.

### Bloco B e regressão da planilha

13. **HIGH — Task 0 deixa duas cópias divergentes de `talvezFinalizarLote`.**  
    Plano: `...e6b-b-cadastro-e-entrada.md:60-62` lista só `publish-familia-ml`; `:173-183` menciona no máximo o worker de UPDATE.  
    Código real: há três cópias: `publish-familia-ml/processar.ts:44-51`, `update-familia-ml/processar.ts:41-48` e `publicar-split-ml/index.ts:35-42`. A terceira é o caminho de planilha/split e ficaria com a semântica antiga.  
    **Fix:** extrair uma função compartilhada e migrar os três call sites com testes de caracterização.

14. **BLOCKER — O fluxo de fotos por variação não possui os IDs necessários.**  
    Plano: a edge responde só `{loteId,familiaId}` em `...e6b-b-cadastro-e-entrada.md:767` e `:917`; a mutation preserva apenas esses campos em `:1283-1290`, mas o upload exige `variacaoId` em `:1273-1276`.  
    Código real: `pre-subir-fotos.ts:42-55` vincula cada foto pelo `variacoes.id`.  
    **Fix:** retornar da edge o mapa `{codigo,id}` das variações criadas e carregá-lo tipado na etapa de fotos.

15. **HIGH — Cadastro parcial é reportado como sucesso pela UI.**  
    Plano: a edge devolve `filaOk` e `falhasEstoque` em `...e6b-b-cadastro-e-entrada.md:890-917`; a mutation em `:1283-1290` descarta ambos e segue para fotos/Revisão.  
    Evidência real: `enfileirarFamilia` é uma publicação direta não transacional ao QStash em `_shared/queue.ts:30-38`.  
    **Fix:** bloquear o estado de sucesso quando estoque ou fila falhar e oferecer retomada explícita e idempotente.

16. **HIGH — A propagação imediata de ajuste manual exigida pela spec não foi implementada.**  
    Plano/spec: a spec exige propagação “na hora” em `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md:136` e `:381`; o plano reduz isso unilateralmente para até 24h em `...e6b-a-estoque.md:392-393` e `:1835`.  
    Código real: a policy permite UPDATE direto (`20260705165828_e7_rls_org.sql:18-21`), mas não existe mecanismo banco→QStash.  
    **Fix:** implementar edge de ajuste com enqueue imediato ou alterar a spec/critério de saída antes de codar.

17. **MEDIUM — Duas superfícies exigidas pela spec desapareceram das tasks.**  
    Plano/spec: a spec pede canais publicados na lista e rótulo de origem em Lotes em `...design.md:199` e `:320-323`; `ProdutoComSaldo` não contém canais em `...e6b-b-cadastro-e-entrada.md:1065-1073`, e nenhuma task modifica a tela de Lotes.  
    **Fix:** adicionar query/UI de canais por produto e a alteração explícita da listagem de Lotes.

A mudança de `talvezFinalizarLote` em si não quebra a lógica conhecida: priorizar `publicando`, depois `pronto`, depois `pendente/processando` é coerente. O risco é aplicá-la somente a parte dos workers. A regressão mais concreta ao caminho de planilha é justamente a divergência entre publish/update/split; não encontrei alteração planejada diretamente em faturamento ou nos cálculos financeiros.

VERDICT: REVISE
### Resposta do Claude (round 1)

Aceitos e corrigidos (todos os 4 BLOCKERs e 9 dos HIGHs):

1. grant execute ao service_role nas 3 RPCs (o revoke sozinho as tornava inexecutáveis).
2. p_ref obrigatório em baixar/estornar — o índice único é PARCIAL, ref nula matava a idempotência.
3. `revoke update (estoque) on variacoes from authenticated` — a RLS do E7 dava UPDATE completo,
   contornando o gate pago e o ledger. Pré-voo executado: ZERO escritores de estoque no browser,
   então o revoke é seguro. Consequência: o trigger de ajuste_manual virou código morto por
   construção e foi REMOVIDO junto com o motivo.
4. estornar_estoque virou RPC atômica ancorada no movimento de venda (localiza com FOR UPDATE e
   usa abs(quantidade) dele). Elimina o check-then-act e a divergência de quantidade. houveBaixa
   deixou de existir.
5. Guard de SKU já usado por outro produto da org no cadastro (a unique é só (familia_id, codigo)).
   O caso vindo de planilha fica registrado como risco pré-existente.
6. O gancho deixou de depender de novaPaga e passou a gatear em `pedido.status === 'paid'`.
   novaPaga é one-shot, então falha parcial era permanente. A idempotência agora vem do ledger.
   Isto substitui a proposta de outbox: mesmo efeito, sem tabela nova.
7. baixar_estoque devolve jsonb com `aplicado` — só enfileira quando ESTA execução aplicou o
   movimento. Mata o job duplicado sob concorrência e elimina a releitura do ledger.
8. Falha fechada no shipment: só repõe com status pré-despacho explicitamente conhecido
   (ou pedido sem envio). shipment null deixou de significar "não despachado".
9. Entrada re-enfileira também no caminho duplicado (push absoluto é idempotente).
10. Eliminado com o item 7 — não há mais releitura do ledger cujo error pudesse ser ignorado.
11. FABRICA_TOKEN por canal; canal sem fábrica loga e pula, em vez de aplicar refresh do ML.
12. Aceito: split+UP redigido como forward-compatible, não como fluxo validado.
13. Aceito e ampliado: são TRÊS cópias de talvezFinalizarLote (publish, update, publicar-split-ml),
    não duas. A task extrai _shared/lote/finalizar.ts e migra os três call sites.
14. A edge devolve `variacoes: [{id, codigo}]` — o upload de foto precisa do variacao_id.
15. filaOk e falhasEstoque deixaram de ser descartados: a UI bloqueia o sucesso e oferece
    Reprocessar / Dar entrada.
16. Spec sincronizada (D-10): ajuste manual não propaga na hora. Com o item 3, o caminho
    deixou de existir, então não há mais divergência entre spec e plano.
17. Aceitos: coluna Canais na tela de Estoque e chip de origem na tela de Lotes.

Nada rejeitado nesta rodada.
