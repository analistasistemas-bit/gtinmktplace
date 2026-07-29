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

## Round 2 — Codex

O plano ainda não está seguro para implementação. Há três bloqueadores de integridade de estoque.

### Achados materiais

1. **BLOCKER — cancelamento de venda sem saldo cria estoque fantasma**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md:265-276,308-311,344-345`.
   - Evidência real: o estoque atual é inteiro em `supabase/migrations/20260527125643_familias_variacoes.sql:108`; a spec exige baixar até zero e estornar somente o efetivamente baixado em `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md:131,134`.
   - Problema: com saldo 2 e venda de 5, `baixar_estoque` grava `quantidade=-5`, mas só remove 2; `estornar_estoque` usa `abs(-5)` e deixa saldo 5, criando 3 unidades.
   - Fix: grave no movimento `-(v_antes-v_novo)` — e guarde a quantidade pedida em outra coluna se ela for necessária para auditoria/notificação.

2. **BLOCKER — `FOR UPDATE` não serializa cancelamento quando a baixa ainda não existe**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md:306-315`.
   - Evidência real: o handler atual busca e persiste pedidos de forma concorrente em `supabase/functions/sync-venda/index.ts:74-98`; `upsertVenda` faz leitura anterior e upsert separados em `supabase/functions/_shared/faturamento/io.ts:226-245`.
   - Problema: `SELECT ... FOR UPDATE` não bloqueia uma linha ausente. Se o cancelamento consultar antes de a execução `paid` inserir o movimento, retorna `sem_baixa_registrada`; depois a execução `paid` baixa o saldo, sem novo cancelamento garantido.
   - Fix: serialize por `(org, canal, pedido, sku)` e persista um tombstone de cancelamento que `baixar_estoque` consulte atomicamente; apenas advisory lock não basta quando o cancelamento vence a corrida.

3. **BLOCKER — ledger + `aplicado` não equivale a outbox**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md:872-910,1471-1506,1519-1549`.
   - Evidência real: o publish QStash é uma chamada externa independente em `supabase/functions/_shared/queue.ts:30-38,64-90`; o `sync-venda` encerra com sucesso em `supabase/functions/sync-venda/index.ts:136-145`.
   - Problema: a RPC pode commitar `aplicado=true` e o enqueue falhar. A exceção é engolida; no retry, a RPC devolve `aplicado=false`, `paisAfetados` fica vazio e o enqueue nunca é repetido. Isso afeta baixa e estorno. A reconciliação diária reduz impacto, mas não entrega o mesmo efeito nem propagação imediata.
   - Fix: use outbox transacional — ou estado durável equivalente no ledger, com claim/dispatch confirmado — em vez de usar `aplicado` como marcador de entrega ao QStash.

4. **HIGH — o `REVOKE UPDATE (estoque)` não revoga um privilégio `UPDATE` concedido na tabela**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md:424-476`.
   - Evidência real: existe policy de UPDATE amplo em `supabase/migrations/20260705165828_e7_rls_org.sql:13-21`, e o browser realmente atualiza outras colunas de `variacoes` em `src/lib/queries.ts:292-303,342-355,378-386,755-768` e `src/lib/publicar.ts:3-9`.
   - Problema: privilégios de tabela e coluna são cumulativos; não existe “deny” de coluna. Se `authenticated` conserva `UPDATE` na tabela, revogar somente o grant da coluna não bloqueia `estoque`. Portanto, o pré-voo pode passar e D-15 continuar falso. Isso provavelmente não quebra os caminhos existentes justamente porque é ineficaz.
   - Fix: revogue `UPDATE` da tabela e conceda explicitamente as colunas editáveis, ou adicione um `BEFORE UPDATE OF estoque` que rejeite `authenticated`, preservando `service_role`.

5. **HIGH — a janela de reutilização do lote ainda permite lote concluído com família pendente**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-b-cadastro-e-entrada.md:907-932`; finalizador em `:158-207`.
   - Evidência real: o trigger só promove lote cujo estado ainda seja `processando` em `supabase/migrations/20260609132501_lote_transicao_revisao.sql:27-34`; os três finalizadores atuais realmente existem em `publish-familia-ml/processar.ts:44-51`, `update-familia-ml/processar.ts:41-48` e `publicar-split-ml/index.ts:35-42`.
   - Problema: no lote reutilizado, a Task 5 atualiza o lote para `processando` antes de inserir a família. Um worker pode finalizar o lote nesse intervalo, não enxergar a família e gravar `concluido`; a inserção posterior deixa uma família `pendente` dentro dele.
   - Fix: mova a atualização para `processando` para depois da inserção bem-sucedida da família, ou faça reuso + inserção numa RPC transacional com lock do lote.

6. **HIGH — o gate de integração com conector fake não pode passar**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md:1316-1329,1371-1397,1854-1865`.
   - Evidência real: `getValidAccessTokenConexao` é exclusivamente ML em `supabase/functions/_shared/ml/token.ts:95-113`; o registry aceita fake em teste em `supabase/functions/_shared/canais/registry.ts:8-18`.
   - Problema: `resolverConexao` e `getConnector` são injetáveis, mas `FABRICA_TOKEN` não. Para `fake`, o worker cai em “sem fábrica” e nunca chama o conector, contrariando todos os casos da Task 11. Além disso, `resolverConexao`, `getConnector` e `atualizarEstoque` podem lançar fora de qualquer `try`, então “falha de um canal nunca afeta outro” não é verdade.
   - Fix: injete também `fabricarToken` em `DepsSincronizacao` e encapsule cada alvo inteiro em `try/catch`, classificando a exceção como retentável ou definitiva.

7. **HIGH — a reconciliação e a tela truncam dados acima do limite PostgREST**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md:1627-1649`; `docs/superpowers/plans/2026-07-28-e6b-b-cadastro-e-entrada.md:1208-1247`.
   - Evidência real: o projeto já possui paginação porque o PostgREST trunca aproximadamente em 1.000 linhas, conforme `src/lib/fotos-produto.ts:21-28`; o faturamento também pagina em `supabase/functions/_shared/faturamento/io.ts:45-69`.
   - Problema: a reconciliação pode ignorar movimentos/anúncios, inclusive a única recuperação prevista para enqueue perdido; a tela pode escolher uma família histórica como canônica ou omitir produtos.
   - Fix: use `buscarTodasPaginas`/`.range()` nas consultas da tela e paginação equivalente no worker.

8. **MEDIUM — retry do cadastro após perda da resposta não é retomável**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-b-cadastro-e-entrada.md:868-883,975-985,1376-1387`.
   - Evidência real: a aplicação usa `supabase.functions.invoke` e trata respostas de erro como exceção; o padrão planejado em `:1377-1383` descarta `familiaId`/`loteId` assim que encontra `r.error`.
   - Problema: se o cadastro concluir e a resposta se perder, o retry recebe 409. Embora a edge devolva IDs, `cadastrarProduto` lança apenas a mensagem e a UI não consegue retomar fotos, estoque ou fila.
   - Fix: trate o 409 “mesmo produto” como resultado recuperável com IDs e consulte/devolva também `variacoes`, `filaOk` e falhas pendentes, ou introduza uma referência idempotente de cadastro.

9. **MEDIUM — `pushOk` é produzido, mas descartado pela UI**

   - Plano: a edge devolve e exige aviso em `docs/superpowers/plans/2026-07-28-e6b-b-cadastro-e-entrada.md:1073-1104`; o cliente tipa e retorna somente estoque/duplicada em `:1250-1260`; o diálogo em `:1291-1303` não trata `pushOk`.
   - Evidência real: chamadas QStash podem falhar porque são operações remotas em `supabase/functions/_shared/queue.ts:30-38,64-90`.
   - Problema: o operador recebe sucesso silencioso mesmo quando os anúncios ficaram defasados, contrariando a própria regra da Task 6.
   - Fix: inclua `pushOk` no retorno de `registrarEntrada` e obrigue o diálogo a exibir o aviso previsto.

10. **MEDIUM — os documentos executáveis continuam contradizendo as mudanças**

   - Plano: `PLAN-E6B.md:22-23,43`; plano A `:7,33,49,73-74,1458-1460,1493-1494,1894,1931`; prova SQL obsoleta em `:493-510,526-528`.
   - Evidência real: `novaPaga` é one-shot em `supabase/functions/_shared/faturamento/io.ts:269-270`; não existe hoje trigger de estoque nem qualquer das novas RPCs no código real.
   - Problema: a Task 1 manda copiar a spec verbatim, mas a spec ainda exige `novaPaga`, trigger, `ajuste_manual` e assinaturas antigas em `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md:129-140,152-173,253-269,379-385`. A prova SQL chama `estornar_estoque` com cinco argumentos e espera `NULL`, portanto falhará com o contrato novo.
   - Fix: atualize spec, resumo, cabeçalhos, ADR source e prova SQL antes de começar a implementação.

### Rastreamento do segundo `sync-venda`

Na segunda execução de um pedido pago, `upsertVenda` devolve `novaPaga=false`, então o alerta de venda paga e a mensagem ao comprador não duplicam. O novo bloco ainda executa, mas `baixar_estoque` devolve `aplicado=false`: não há nova baixa, job ou alerta de sem saldo. No cancelamento, o estorno duplicado também não altera saldo nem enfileira. `reservarNotificacao` aceita qualquer entidade (`string`) em `supabase/functions/_shared/faturamento/notificacoes-dedupe.ts:13-24`, e `vendas`/`pos_venda` são categorias válidas em `supabase/functions/_shared/notificacoes/categorias.ts:5-13`.

Isso evita duplicatas, mas cria entrega *at-most-once*: a reserva acontece antes de `notificarCategoria`; se o envio falhar, o retry encontra a reserva e não tenta novamente. Para os novos alertas, isso é perda possível, não idempotência de entrega.

### Pontos revalidados sem achado

- O bloco `EXCEPTION WHEN unique_violation` não aborta a transação externa; a subtransação PL/pgSQL é adequada.
- `search_path = ''` não quebra as funções apresentadas: tabelas estão qualificadas e `pg_catalog` continua implicitamente pesquisado.
- O índice parcial funciona para referências não nulas, e os novos guards impedem `p_ref` vazio nas RPCs relevantes.
- Com `EXECUTE` apenas para `service_role`, não encontrei vazamento cross-tenant direto nas três funções `security definer`.
- `itens`, `pedido`, `orgId`, `userId`, `shipment` e `admin` estão no escopo real do ponto proposto em `sync-venda`; os novos helpers serão imports.
- `resolverAlvosPush` corresponde à forma real de `anuncios_externos` e `anuncios_externos_itens`, incluindo split e pai UP com `item_externo_id=null`; não encontrei defeito material nessa resolução.
- A extração de `talvezFinalizarLote` cobre as três cópias reais; não existe quarta cópia encontrada.

VERDICT: REVISE
### Resposta do Claude (round 2)

Aceitos e corrigidos — os 3 BLOCKERs e os 4 HIGHs:

1. Estoque fantasma no estorno: `quantidade` passa a ser o DELTA REALMENTE APLICADO
   (v_novo - v_antes) e o pedido vai para `quantidade_pedida`. Com saldo 2 e venda 5, o
   movimento grava -2 e o estorno devolve 2, não 5. Prova SQL nova (passo C+D) cobre isso.
2. FOR UPDATE não trava linha ausente: adicionado TOMBSTONE. `estornar_estoque` sem baixa
   correspondente grava `cancelamento_sem_baixa` na mesma referência; `baixar_estoque`
   consulta a marca e recusa aplicar, virando `venda_cancelada_antes`. Prova SQL passo D2.
3. Outbox: eu estava errado ao rejeitar. Coluna `push_enfileirado_em` no ledger, mais
   `lerPushPendente`/`despacharPushPendente`. O que enfileirar vem da varredura de pendentes,
   não do retorno da RPC; a marca só é gravada DEPOIS do enqueue aceito. Sem tabela nova,
   mas com a durabilidade que o `aplicado` não dava.
4. `revoke update (estoque)` era inócuo (privilégios de tabela e coluna são cumulativos,
   não existe deny de coluna). Trocado por trigger `before update of estoque` que levanta
   exceção quando auth.uid() não é nulo. Preserva service_role.
5. Janela de corrida do lote: o UPDATE para 'processando' foi movido para DEPOIS do insert
   da família.
6. `fabricarToken` virou dependência injetável (sem isso o teste com o fake não exercitava
   nada), e cada alvo do push ficou dentro de try/catch com exceção tratada como retentável.
7. Paginação (`paginarTudo` / `buscarTodasPaginas`, que já existem no repo) na reconciliação
   e em fetchProdutosComSaldo.
8. 409 vira ProdutoJaExisteError com familiaId/loteId, para a tela poder retomar.
9. `pushOk` incluído no retorno de registrarEntrada e obrigatório no diálogo.
10. Spec sincronizada: D-6 (paid, não novaPaga), D-8 (duas quantidades), D-18 (outbox),
    D-19 (tombstone), D-20 (trigger de bloqueio); motivos, diagrama e prova SQL atualizados;
    ajuste manual e devolução movidos para "fora de escopo".

Nada rejeitado nesta rodada. A observação sobre entrega at-most-once do reservarNotificacao
é procedente, mas é o padrão já vigente no repo para os alertas existentes — fica registrada
como característica conhecida, não como mudança deste épico.

## Round 3 — Codex

Ainda não está implementável com segurança. Restam dois bloqueadores de concorrência/roteamento e dois defeitos funcionais claros.

1. **BLOCKER — tombstone e baixa continuam concorrendo sem uma trava comum**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md:252-279` e `:345-365`.
   - Evidência real: execuções distintas do handler podem buscar estados diferentes do mesmo pedido antes de `upsertVenda`, em `supabase/functions/sync-venda/index.ts:74-98`.
   - Quebra: o `FOR UPDATE` do estorno não espera por uma baixa ainda não commitada porque, no snapshot do `SELECT`, a linha “não existe”. Como venda e tombstone têm referências diferentes, o índice único também não serializa. Interleaving válido: baixa insere venda → consulta tombstone e não acha → cancelamento insere tombstone → baixa aplica o estoque. O cancelamento fica registrado, mas a venda também é aplicada e nunca estornada.
   - Sobre bloquear venda legítima: fora dessa corrida, não encontrei evidência de bloqueio indevido; o tombstone está vinculado ao pedido/SKU cancelado e o handler consulta o estado atual do pedido.
   - **Fix:** adquirir em ambas as RPCs um `pg_advisory_xact_lock` com a mesma chave derivada de `(org_id, referência da venda)` antes de qualquer `INSERT`/`SELECT`.

2. **BLOCKER — o outbox mistura movimentos com políticas de propagação incompatíveis**

   - Plano: `e6b-a-estoque.md:1015-1055`, `:1651-1655`, `:1708-1715`; `e6b-b-cadastro-e-entrada.md:961-970` e `:1075-1105`.
   - Evidência real: o handler é reexecutável por pedido em `supabase/functions/sync-venda/index.ts:65-98`; o cliente administrativo usado nesses caminhos é global à org, não à execução, em `supabase/functions/_shared/supabase.ts:3-8`.
   - Quebra: `lerPushPendente` lê todos os pendentes da org sem trazer o tipo/canal do movimento. Depois, um único `canalOrigem` fornecido pelo chamador é aplicado ao lote inteiro. Assim, uma venda ML pode drenar e marcar como entregue uma entrada/estorno usando `canal_origem='mercado_livre'`, deixando de atualizar o ML; uma entrada pode drenar uma venda com `canal_origem=null` e reempurrar ao ML o saldo local. O `UPDATE` ainda marca todos os IDs agrupados pelo produto após apenas esse job incorretamente roteado.
   - Agravante: cadastro inicial e entrada enfileiram diretamente e nunca preenchem `push_enfileirado_em`; portanto permanecem pendentes e serão posteriormente drenados por qualquer execução de `sync-venda`.
   - **Fix:** persistir no movimento a intenção de despacho (`push_canal_origem`, ou equivalente), retornar esse campo na leitura, agrupar por `(codigo_pai, push_canal_origem)` e fazer cadastro/entrada usarem exclusivamente o mesmo dispatcher.

3. **HIGH — a marca do outbox pode falhar silenciosamente e a reconciliação nunca a grava**

   - Plano: `e6b-a-estoque.md:1050-1059` e `:1815-1850`.
   - Evidência real: o padrão Supabase do projeto retorna erros como valor; não lança automaticamente — por exemplo, `supabase/functions/ingest-lote/index.ts:309-312` verifica explicitamente `varErr`.
   - Quebra: o resultado do `update({ push_enfileirado_em: ... })` é ignorado. Se o banco rejeitar a atualização, a função aparenta sucesso e reenvia indefinidamente. A reconciliação também enfileira os pendentes, mas jamais atualiza `push_enfileirado_em`; logo eles serão reenviados diariamente para sempre, sempre com `canal_origem=null`.
   - A ordem enqueue → marca está correta e não marca cedo demais; o defeito é ignorar a falha e não marcar no reconciliador.
   - **Fix:** verificar e propagar o `error` do `UPDATE`, e fazer a reconciliação chamar o mesmo dispatcher orientado pelos dados do movimento.

4. **HIGH — o tratamento de 409 continua inalcançável**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-b-cadastro-e-entrada.md:1398-1411`.
   - Evidência real: `src/pages/Organizacoes.tsx:29-43` documenta e trata o comportamento real: em resposta não-2xx, `invoke` não popula `data`; o corpo está em `error.context`.
   - Quebra: `if (error) throw error` acontece antes da construção de `ProdutoJaExisteError`. Em um 409 real, `familiaId` e `loteId` nunca são lidos e o fluxo de recuperação prometido permanece quebrado.
   - **Fix:** antes do erro genérico, detectar `error.context.status === 409`, ler `await error.context.json()` e construir `ProdutoJaExisteError` com os IDs.

5. **MEDIUM — os documentos executáveis ainda contradizem as decisões revisadas**

   - Plano: `PLAN-E6B.md:22-23,36,43,47-52`; `e6b-a-estoque.md:5-7,32-34,49,73-74,628-635`; spec `2026-07-28-cadastro-manual-e-estoque-design.md:225-269`.
   - Evidência real: `paginarTudo` existe apenas como função não exportada em `supabase/functions/_shared/faturamento/io.ts:41-52`; portanto o uso proposto em `e6b-a-estoque.md:1804-1812` não compila por simples importação.
   - Quebra: o plano mestre ainda manda usar `novaPaga` e trigger de ajuste; a spec ainda mostra schema sem `quantidade_pedida`/`push_enfileirado_em` e assinaturas antigas; a prova SQL chama `estornar_estoque` com cinco argumentos antigos e espera erro de permissão em vez do novo erro do trigger. A Task 1 ainda manda copiar apenas D-1..D-15, omitindo D-16..D-20.
   - **Fix:** sincronizar schema, assinaturas, prova SQL, fluxo e ADR D-1..D-20; definir/exportar um paginador que também verifique erros PostgREST.

O trigger novo não quebra os caminhos reais examinados: `adminClient()` usa exclusivamente a chave `service_role` (`_shared/supabase.ts:3-8`), enquanto o cliente com JWT do usuário é separado (`:11-17`). O re-ingest mostrado em `ingest-lote/index.ts:309-312` usa escrita administrativa e não carrega `auth.uid()`. Também não encontrei escritor browser legítimo de `variacoes.estoque` que precise ser preservado.

VERDICT: REVISE
## Round 4 — Codex

Ainda há um bloqueador material na reconciliação e duas inconsistências executáveis.

1. **BLOCKER — “re-push cobre webhook perdido” está conceitualmente invertido**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md:1825-1832,1869-1884,1901-1911`; spec `:142`.
   - Evidência real: `supabase/functions/sync-venda/index.ts:65-98` só busca o pedido quando recebe um job com `order_id`/`shipping_id`. Não existe polling de vendas ausentes.
   - Quebra: webhook perdido significa que o ledger e o estoque local continuam altos. O reconciliador lê esse saldo desatualizado e o envia para todos os canais, inclusive o marketplace onde a venda ocorreu, podendo restaurar unidades já vendidas e ampliar o oversell.
   - **Fix:** a reconciliação de webhook perdido precisa primeiro importar pedidos/vendas ausentes e aplicar a baixa; até isso existir, restrinja o re-push a movimentos existentes/outbox e remova o conjunto “multicanal sem movimento”.

2. **HIGH — o código não exclui pendências do re-push preventivo**

   - Plano: `e6b-a-estoque.md:1881-1911`.
   - Evidência real: o worker de venda é assíncrono e independente em `supabase/functions/sync-venda/index.ts:74-98`; não há ordenação transacional entre ele e o reconciliador.
   - Quebra: embora o comentário diga “estes NÃO têm movimento pendente”, `alvos` inclui explicitamente todos os `pendentes` em `:1883`, e o loop nunca os remove. Cada pendência gera o job correto pelo dispatcher e, logo depois, outro job com `canal_origem:null`, anulando a política de exclusão do canal de origem.
   - Além disso, cada org drena no máximo 1.000 movimentos (`:1893-1895`), apesar de a leitura anterior ser paginada.
   - **Fix:** criar `chavesPendentes`, excluir essas chaves do loop preventivo e drenar cada org em páginas até `lerPushPendente` retornar vazio.

3. **HIGH — `registrarEntrada` ainda não implementa o tratamento de erro prometido**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-b-cadastro-e-entrada.md:1265-1275`; a correção aparece apenas como instrução posterior em `:1436`.
   - Evidência real: `src/pages/Organizacoes.tsx:29-43` confirma que respostas não-2xx deixam o corpo em `error.context`, não em `data`.
   - Quebra: o snippet executável ainda faz `if (error) throw error`; portanto mensagens da edge são perdidas e o diálogo recebe um erro genérico. Dizer depois para “aplicar o mesmo cuidado” deixa o código principal incorreto.
   - **Fix:** substituir o snippet pelo tratamento efetivo de `error.context`, idealmente extraindo um helper compartilhado usado também por `cadastrarProduto`.

4. **MEDIUM — assinaturas e prova SQL continuam dessincronizadas**

   - Plano/spec: spec `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md:262-268`; Plano A `:153-157,618-629,647-649,651-655,884-900`.
   - Evidência: a implementação planejada define quatro argumentos em `e6b-a-estoque.md:347-349`, e o chamador planejado usa esses quatro campos em `:1122-1126`.
   - Quebra: a spec ainda declara `baixar_estoque returns integer` e o estorno antigo com quantidade; a interface da Task 3 omite `p_codigo`; E3 ainda chama cinco argumentos antigos e espera `NULL`; o contrato TypeScript ainda expõe `paisAfetados`, enquanto a implementação devolve `pendentesDePush`. A prova do trigger também espera “erro de permissão na coluna”, mas agora será a exceção customizada.
   - **Fix:** tornar a assinatura SQL de quatro argumentos e `pendentesDePush` canônicos em todas as seções e corrigir E3/expectativas.

Sobre o ponto específico da entrada: o enqueue direto em `entrada-estoque` não é defeito material depois de `push_canal_origem`. Ele causa no máximo um push redundante; o dispatcher posterior usa a intenção correta e marca o movimento. Já o cadastro inicial, no texto atual, não enfileira estoque diretamente (`e6b-b-cadastro-e-entrada.md:961-970` apenas chama a RPC). Isso também é aceitável porque o produto ainda não está publicado e a publicação consumirá o saldo canônico.

O advisory lock usa a mesma chave nas duas RPCs e fecha o interleaving identificado. Não encontrei novo bloqueio de venda legítima pelo tombstone. O trigger continua preservando `service_role` e o re-ingest administrativo.

VERDICT: REVISE
### Resposta do Claude (rounds 3 e 4)

Round 3 — todos aceitos:
- Advisory lock `pg_advisory_xact_lock(hash(org|ref_venda))` no início de baixar_estoque E
  estornar_estoque. Só o índice único não serializava: venda e tombstone têm referências
  diferentes e FOR UPDATE não espera linha não-commitada.
- Coluna `push_canal_origem`: a intenção de propagação passa a viver no movimento.
  despacharPushPendente agrupa por (codigo_pai, push_canal_origem) e não recebe mais
  canal do chamador — antes, uma venda no ML drenava uma entrada marcando-a como
  entregue sem atualizar o ML.
- error do update de push_enfileirado_em verificado; reconciliação drena pelo mesmo
  dispatcher (e portanto marca o outbox).
- 409 lido de error.context (invoke não popula data em não-2xx).
- paginarTudo marcada para extração/exportação.

Round 4 — todos aceitos:
- O conjunto "multicanal sem movimento" da reconciliação foi REMOVIDO. O racional estava
  invertido: webhook perdido = saldo local alto demais; re-empurrar restauraria unidades
  vendidas. Recuperação real de webhook perdido exige importar o pedido faltante — fora
  de escopo, registrado.
- chavesPendentes excluídas do re-push preventivo; drenagem do outbox virou laço paginado.
- registrarEntrada e cadastrarProduto passam a usar helper compartilhado de erro de edge
  (com leitura única do Response.json).
- Assinaturas canônicas (estornar com 4 args, baixar returns jsonb, pendentesDePush) e
  prova SQL sincronizadas; expectativa do trigger corrigida.

Aceito também o veredito do Codex sobre o enqueue direto da entrada: não é defeito
material depois de push_canal_origem — causa no máximo um push redundante, e push
absoluto é idempotente.

## Round 5 — Codex (final, MAX_ROUNDS atingido)

Ainda restam dois problemas materiais. Ambos são correções locais, mas o plano não deve ser executado literalmente antes delas.

1. **HIGH — bloqueador de implementação: a drenagem pode repetir a mesma falha 50 vezes**

   - Plano: `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md:1097-1113` e `:1896-1903`.
   - Evidência real: cada enqueue realiza chamadas remotas aguardadas ao QStash, como mostra `supabase/functions/_shared/queue.ts:103-114`.
   - Quebra: `despacharPushPendente` captura tanto falha de enqueue quanto falha ao marcar o ledger e retorna normalmente. O laço imediatamente relê os mesmos pendentes. Uma falha persistente pode gerar 50 tentativas na mesma execução; se o enqueue foi aceito mas a marca falhou, pode criar 50 jobs duplicados. Além disso, 50 páginas de 500 grupos podem representar milhares de chamadas sequenciais numa única edge.
   - **Fix:** fazer o dispatcher retornar contagem de marcados/falhas e interromper a drenagem quando houver falha ou nenhum progresso; limitar cada execução a uma quantidade operacionalmente pequena de páginas.

2. **HIGH — bloqueador documental antes da implementação: D-12 perigosa continua na fonte copiada para o ADR**

   - Plano/spec: spec `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md:142`; `PLAN-E6B.md:26`; Plano A `:32,73`.
   - Evidência real: webhook ausente não gera leitura do pedido; `supabase/functions/sync-venda/index.ts:65-98` só consulta o ML quando já existe um job com pedido/envio.
   - Quebra: a spec ainda manda reconciliar produtos multicanal e afirma que isso recupera webhook perdido. O plano mestre repete essa abrangência. Pior: a Task 1 manda copiar a tabela da spec `verbatim`, produzindo um ADR que contradiz o worker corrigido. Ela ainda diz D-1..D-15, omitindo D-16..D-20, apesar de `CLAUDE.md:72-75` exigir que a decisão arquitetural esteja no ADR antes da implementação.
   - A spec também mantém critérios antigos em `:390-391`: “ajuste manual propaga” e “devolução notifica”, ambos explicitamente removidos.
   - **Fix:** atualizar D-12, o resumo, os critérios de saída e a Task 1 para D-1..D-20 antes de escrever o ADR.

As correções centrais estão tecnicamente boas: advisory lock comum fecha a corrida; tombstone não bloqueia venda legítima no fluxo modelado; intenção do outbox está preservada; `chavesPendentes` funciona; os helpers consomem `Response.json()` uma vez; e o trigger continua seguro para `service_role` e re-ingest.

O byte NUL ainda presente em `e6b-a-estoque.md:1090` é apenas ajuste mecânico durante a execução: substitua-o por um separador escapado ou uma chave estruturada. Ele não muda o desenho, mas já faz ferramentas tratarem o Markdown como binário.

VERDICT: REVISE
### Resposta do Claude (round 5) — aplicada SEM re-verificação do Codex

Ambos aceitos. Não houve desacordo em nenhuma das 5 rodadas.

1. Drenagem do outbox: `despacharPushPendente` passa a devolver `{marcados, falhas}` e o
   laço da reconciliação PARA no primeiro sinal de falha ou de não-progresso. Teto baixado
   de 50 páginas de 500 para 5 páginas de 200. Sem isso, uma falha persistente repetiria a
   chamada remota N vezes na mesma execução e, com enqueue aceito + marca falhando,
   criaria N jobs duplicados.
2. D-12 reescrita na spec, no PLAN-E6B.md e no plano A: a reconciliação é rede de segurança
   do PUSH, não do WEBHOOK. Critérios de saída antigos ("ajuste manual propaga", "devolução
   notifica") removidos. A Task 1 agora manda copiar D-1..D-20 (antes: D-1..D-15), incluindo
   as cinco decisões nascidas nesta revisão.
3. Byte NUL na linha 1090 (eu havia escrito um separador NUL literal numa chave de Map):
   trocado por `JSON.stringify([codigoPai, canalOrigem])`. Nenhum doc tem NUL agora.

ESTADO FINAL: o loop terminou por esgotar MAX_ROUNDS=5, não por APPROVED. O último veredito
foi REVISE com 2 HIGH, ambos classificados pelo próprio Codex como "correções locais", e o
próprio veredito afirma que "as correções centrais estão tecnicamente boas". As duas foram
aplicadas — mas NÃO foram re-verificadas por uma sexta rodada. Quem executar o plano deve
tratar esses dois pontos (drenagem do outbox e D-12/ADR) como os mais recentes e menos
revisados.

## Round 6 — Codex (rodada extra autorizada pelo Diego)

A lógica nova da drenagem está correta, mas os critérios de saída ainda não foram realmente sincronizados. É uma correção documental pequena, porém necessária antes do handoff.

- `r.marcados === 0` não para cedo em caso legítimo. Com página não vazia, cada grupo contém ao menos um ID; sucesso incrementa `marcados`, e qualquer falha incrementa `falhas`. Página vazia já termina antes do dispatcher.
- Contar `marcados` por IDs é coerente: o critério usa apenas zero versus progresso. Um grupo com 20 movimentos corretamente representa 20 linhas removidas do outbox.
- O teto de 1.000 movimentos por execução não perde dados. O restante permanece com `push_enfileirado_em IS NULL` e volta na próxima reconciliação, em ordem FIFO. Só haveria crescimento crônico se uma org produzisse sustentadamente mais de 1.000 pendências não despachadas por dia; no fluxo normal, os próprios handlers também drenam o outbox. Convém apenas logar quando `MAX_PAGINAS` for atingido, para observar backlog — não é bloqueador.
- `JSON.stringify([codigoPai, canalOrigem])` é uma chave inequívoca para a tupla e os quatro arquivos têm zero bytes NUL.

**MEDIUM — critérios de saída ainda contradizem D-12/D-20**

- Spec: `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md:390-391` ainda exige “ajuste manual propaga” e “devolução notifica”.
- Plano B: `docs/superpowers/plans/2026-07-28-e6b-b-cadastro-e-entrada.md:1616` ainda afirma que existe ajuste manual coberto por reconciliação.
- Isso contradiz a própria spec em `:140,142,414-415`, o Plano A em `:2217-2219` e o desenho efetivo: escrita direta está bloqueada e devolução não é tocada.
- **Fix:** substituir essas três linhas pelos critérios já corretos do Plano A. Não exige mudança arquitetural ou de implementação, mas precisa ser corrigido para o plano ter um único critério de aceite.

VERDICT: REVISE
### Resposta do Claude (round 6)

A drenagem do outbox foi CONFIRMADA correta nos quatro pontos questionados: o critério
`marcados === 0` não para cedo em caso legítimo (numa página não-vazia, todo grupo
incrementa marcados ou falhas, então marcados=0 implica falhas>0); contar por IDs é
coerente com o critério; o teto de 1.000/execução não perde dado (o resto continua com
push_enfileirado_em NULL e volta em FIFO); e a chave do Map é inequívoca.

Único achado, MEDIUM documental, corrigido:
- Critérios de saída da spec (itens 3, 4 e 5) e do Plano B ainda diziam "ajuste manual
  propaga" e "devolução notifica" — ambos removidos do desenho nas rodadas anteriores.
  Reescritos para bater com D-12/D-19/D-20 e com o Plano A.

Aplicada também a sugestão não-bloqueadora: log `reconciliar_outbox_backlog` quando
MAX_PAGINAS é atingido com a página ainda cheia, para backlog não sumir em silêncio.
