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
