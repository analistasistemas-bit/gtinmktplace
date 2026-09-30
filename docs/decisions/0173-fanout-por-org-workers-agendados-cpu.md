# ADR-0173 — Fan-out por organização, em lotes retomáveis, para os workers agendados multi-org

**Status:** Aceito (2026-09-30, após validação em produção — ver "Validação" no fim de "Implantação")
**Data:** 2026-09-27
**Relacionado:** [ADR-0006](0006-qstash-em-vez-de-postgres-queue.md) (QStash),
[ADR-0037](0037-modulo-faturamento-webhooks-ml.md) (backfill/reconciliação de faturamento),
[ADR-0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (Pulse),
[ADR-0172](0172-vendas-sku-analise-por-variacao.md) (molde de fan-out + posse + CAS do cursor em produção)

## Contexto

Em 2026-09-27 três edge functions agendadas estavam falhando por `CPU Time exceeded` (HTTP 546): o
Supabase encerra a requisição ao somar **2 s de CPU**, e os 546 aparecem entre 84 e 131 s de relógio —
antes do teto de 150 s. Medido em `function_logs`/`function_edge_logs` (24–27/09):

- `pulse-coletar` (tier completo, `0 9 * * *`): 3 tentativas com `CPUTime` todo dia. A Avil sozinha
  leva ~70 s e a queda vem na org seguinte; Daludi + Avil somaram 1.976 ms num dia em que coube.
- `backfill-faturamento` (`30 6 * * *`, `{"dias":7}`): 4 tentativas com `CPUTime` todo dia; último run
  completo por volta de 10/09. É o único backstop das mensagens pós-venda (`ml-webhook/index.ts:61`).
- `reconciliar-faturamento` (`0 * * * *`): 12 de 74 execuções com 546 em 72 h.

Causa comum: **todas as organizações são processadas numa única requisição**. Cada org a mais soma CPU
na mesma conta. As guardas existentes (`LIMITE_MS`, `ORCAMENTO_MS`, teto de 30 s das visitas) medem
relógio, não CPU, e por isso não evitam a queda. Reduzi-las não resolve.

## Decisão

1. **Fan-out por org.** A mensagem do schedule (sem `org_id`) vira **disparador**: publica uma mensagem
   por conexão ML para a própria função e responde 200. Os schedules existentes, seus bodies e o número
   de schedules **não mudam**; muda só o que a função faz com eles.
2. **O banco é a fonte da verdade da rodada.** Cada (job, org) tem uma linha em `worker_rodadas` com
   ciclo, `params` (janela/tier gravados na abertura do ciclo), cursor (`etapa|pos`), acumulado e
   `notificar_pendente`. A mensagem só aponta (job, org, ciclo); o cursor nunca viaja na mensagem.
3. **Posse por execução.** Cada execução toma uma posse curta com identidade própria (`lease_id`,
   150 s), processa um lote, faz o CAS do cursor com essa posse, publica a continuação e solta a posse.
   Posse ocupada → HTTP 500 (o QStash repete depois); assim o retry de uma execução que morreu por CPU
   retoma o mesmo lote, e uma continuação publicada em duplicidade só serializa trabalho, nunca repete
   lote. Mensagem de ciclo mais antigo que o da linha → `obsoleta`; ciclo já concluído → `concluida`.
4. **Trabalho limitado por contagem, não por relógio.** Cada mensagem processa no máximo um lote de
   tamanho fixo (produtos, pedidos, packs, claims), ajustável por constante após medição. A lista de
   pedidos da janela é lida inteira a cada mensagem em modo estrito (qualquer página que falha lança,
   nunca lista parcial) e o lote é escolhido localmente por `id` > cursor — o `sort` do ML é por
   `date_closed` e o filtro por `date_created`, então offset entre chamadas não é estável. A leitura confere
   a cobertura (ids únicos = `paging.total`, total estável entre a 1ª e a última página) e lança se houver
   buraco. Pedido que falha vira **pendência da org** (`worker_pendencias`), inclusive as deixadas pela
   recuperação histórica. O backfill só registra; o reconciliar horário é o único que retoma e apaga
   (escopo completo, com `tratarPedidoCancelado`, serializado por org pela posse), e um sucesso só apaga
   falha registrada antes do início da própria tentativa. Na 5ª falha a pendência é marcada descartada,
   sem sumir. Rodada com pendência conclui `parcial`, não `ok`.
   **Ruling 14 (revisão Grok, 2026-09-27):** pedido cuja leitura do MP falha (`carregarLiquidoMPDoPedido`
   devolve `null`, `mpFalhou`) não entra em `ok` **nem** em `falhas` — `ok` apagaria a única
   re-tentativa do estorno de um pedido fora da janela de 72h, e `falhas` descartaria a venda depois
   de 5 leituras ruins do MP (condição transitória, não do pedido). A pendência existente, se houver,
   fica como está (`desfechoPedido`, `reconciliar-faturamento/passo.ts`). **Lacuna aceita, sem
   correção nesta entrega:** na etapa `vendas`, um pedido com MP `null` e **sem** pendência prévia não
   ganha pendência nenhuma (só `pendencias`/`falhas` viram linha em `worker_pendencias`); se ele saia
   da janela de 72h antes de uma leitura boa do MP, o **estorno** daquele pedido não é re-tentado por
   nenhum caminho (a **liberação** é diferente: `reconciliarLiberacoes` roda sempre que a leitura do
   MP da etapa `liberacoes` tem sucesso — para todas as vendas da org com data do MP disponível, sem
   depender de pendência; é pulada quando essa leitura falha — ver ponto 5).
5. **Etapas caras separadas.** Radar do Pulse, perguntas, claims e liberações do Mercado Pago são
   etapas próprias, cada uma em mensagem separada, com CPU medida isoladamente. Nos lotes de vendas, o
   líquido do MP vem pelos pagamentos do próprio pedido (`carregarLiquidoMPDoPedido`, já usado por
   `sync-venda`). A varredura de 120 dias (≤ 80 páginas) fica só na etapa de liberações e **não é
   paginada**: cortar os pagamentos de um pedido entre páginas pode gravar data de liberação errada.
   Portão: **medido na ativação** (Task 8) — se essa mensagem passar de 1.500 ms de CPU, a flag do
   reconciliar é desligada e a alternativa por pedido (varrer os pedidos locais com liberação ainda
   relevante, carregando os pagamentos de cada um por `carregarLiquidoMPDoPedido`) entra como
   **trabalho novo**; ela não existe no código desta entrega.
6. **Deduplicação por (função, job, org, ciclo, cursor).** Ciclo = dia BRT para os jobs diários e hora
   UTC para o reconciliar e o tier quente. Notificação do Pulse: pendência durável na linha (preservada
   mesmo quando chega um ciclo novo), gravada in-app exatamente uma vez por
   (usuário, chave) — `notificacoes (user_id, chave)`, leituras de assinantes e módulo estritas, posse
   mantida até marcar a entrega. O Telegram é **melhor esforço, no máximo uma vez** (só para linha
   in-app recém-inserida); uma queda entre o registro e o envio perde aquele Telegram.
6a. **Limite aceito:** esgotados os retries do QStash, a cadeia da (job, org) para até o próximo ciclo,
   que a assume do zero (pendências preservadas). Fica visível em `worker_rodadas`.
6b. **Ativação por flag.** `FANOUT_BACKFILL`, `FANOUT_PULSE`, `FANOUT_RECONCILIAR` ligam o disparador em
   fan-out; sem a flag o schedule segue no caminho de hoje. O consumidor das mensagens por org fica
   sempre deployado. Rollback = desligar a flag, nunca redeployar a versão antiga com mensagens na
   fila (o handler antigo leria a mensagem por org como execução global). Qualquer versão futura, inclusive
   um rollback de código, mantém a **guarda permanente**: mensagem `modo:'org'` bem formada é reconhecida
   antes de qualquer outro ramo assinado — processada normalmente, ou (numa versão de rollback sem o
   disparador) ignorada com 200 —, nunca tratada como schedule. `modo:'org'` malformada (sem `job`/
   `org_id`/`ciclo`/`params` válidos) responde **400** e nunca cai no disparador nem no caminho legado.
7. **Específico por função:**
   - **Pulse:** o schedule só coleta orgs com o módulo `pulse` habilitado (Avil e Daludi Shop saem até o
     módulo ser ligado; com os lotes, a Avil passa a caber quando for). Tentativa de coleta registrada
     por produto (`coleta_tentativa_em`, `coleta_falhas_seguidas`), com backoff para cpid que falha
     seguidamente, **sem declarar a ficha morta** (`mlGet` devolve `null` para qualquer erro). A
     notificação sai uma vez por rodada, depois de concluída.
   - **Backfill:** o caminho agendado deixa de reler perguntas e claims (o reconciliar relê o mesmo
     histórico de hora em hora, com filtro). Vendas e mensagens viram etapas com cursor. Falha
     transitória ao ler mensagens deixa de virar `[]` calado no caminho do backfill.
   - **Reconciliar:** etapas `perguntas` → `claims` (lotes) → `vendas` (páginas) → `liberacoes`, por org.
8. **Caminho manual intocado.** Os botões "Atualizar agora" (Pulse) e "Sincronizar" (faturamento)
   continuam como hoje, numa requisição só da própria org.

## Consequências

- Uma org lenta ou com falha não derruba as outras; o retry repete só aquele lote daquela org.
- Mensagens QStash: ~+350 por dia (estimativa com as orgs de hoje, a maior parte do reconciliar horário), sem schedule novo. No plano Pay as
  You Go (ativado em 2026-09-27) isso custa centavos por mês. A solução não depende do plano.
- Mais uma tabela de estado (`worker_rodadas`) e duas colunas em `pulse_produtos`.
- `worker_rodadas` passa a dizer, por job e org, quando foi o último `ok` e qual o último erro — base
  para um alarme futuro (fora deste ADR).
- Risco residual aceito no Pulse: queda entre o upsert das ofertas e a gravação dos alertas de um lote
  perde os alertas daquele lote (o diff seguinte já parte do estado novo). Com lotes pequenos a janela
  é curta; é o mesmo risco que já existia com a execução inteira.

## Implementação (2026-09-27)

Código completo na branch `worktree-diag-cpu-546` (Tasks 1-7 do plano de execução em
`docs/superpowers/plans/2026-09-27-fanout-workers-cpu.md`): migration `worker_rodadas`/
`worker_pendencias`, protocolo compartilhado `_shared/rodada/rodada.ts`, e as 3 funções com o modo
fan-out atrás das flags. Runbook completo em `docs/reference/edge-functions.md`; modelo de dados em
`docs/reference/modelo-de-dados.md`. Deploy, ativação medida e recuperação histórica: ver
"Implantação (2026-09-28)" abaixo. Passou a `Aceito` em 2026-09-30, depois da validação em
produção registrada no fim da seção seguinte.

Ponto 5 (líquido do MP) — **no protocolo NOVO por org** (ativo em produção desde 28/09, atrás das
flags): as etapas
`pendencias`/`claims`/`vendas` do reconciliar e a etapa `vendas` do backfill (que não tem etapa
`pendencias` — o cursor do backfill começa direto em `vendas`, `backfill-faturamento/passo.ts:42`)
lêem o líquido por pedido (`carregarLiquidoMPDoPedido`). A etapa `liberacoes` do reconciliar é a
**única** que continua na varredura de 120 dias (`carregarLiquidoMP`,
`reconciliar-faturamento/passo.ts` → `liberacoes()`) — sem paginação, sem a alternativa por pedido
(que não existe no código desta entrega; ver o portão do ponto 5, acima). A equivalência entre os
dois caminhos (mesmo líquido/liberação para o mesmo pedido, incluindo estorno total e parcial) está
provada em `supabase/functions/_shared/faturamento/__tests__/mp-por-pedido.test.ts`, sem
divergência nos 4 casos testados — isso mostra que a alternativa por pedido É viável para a etapa
`liberacoes` se o portão de CPU disparar na ativação, mas não implementa essa alternativa. Medido
na ativação: a rodada do reconciliar (30 mensagens, incluindo a etapa `liberacoes`) teve máximo de
299 ms — portão de 1.500 ms atendido.

## Implantação (2026-09-28)

Merge fast-forward na main (`48fad83f..fb3b2c72`, ~00:30 UTC). `supabase db push` aplicou
`20260927205804_worker_rodadas.sql` (~00:28 UTC): tabelas `worker_rodadas`/`worker_pendencias`, as 7
RPCs de posse/CAS/pendência, colunas `pulse_produtos.coleta_tentativa_em`/`coleta_falhas_seguidas`,
`notificacoes.chave` + índice único, RLS ligada nas 2 tabelas novas (escrita só `service_role`);
`npm run db:check` alinhado. Deploy das 17 funções que importam `_shared` alterado (~00:29 UTC),
todas `ACTIVE`.

**Flags ligadas (~00:33–00:42 UTC, digest conferido = sha256("1")):** `FANOUT_BACKFILL=1`,
`FANOUT_PULSE=1`, `FANOUT_RECONCILIAR=1`. Schedules do QStash não mudaram.

**Ativação medida** (1 disparo manual por função, mesmo body do schedule):

- **backfill** (`{"dias":7}`): 3 orgs `ok`, rodada ~4 min, 38 mensagens, `cpu_time_used` mediana
  197 ms / máx 311 ms, 0 `CPUTime`, 0 falhas, 0 pendências.
- **pulse** (`{"tier":"completo"}`): só a DSA (Avil e Daludi Shop sem o módulo `pulse`), `ok`, 21
  produtos, 7 alertas (0 de ação), 1 notificação com chave (sem duplicata), 5 mensagens, máx
  1.152 ms.
- **reconciliar** (sem body): 3 orgs `ok`, 30 mensagens, mediana 142 ms / máx 299 ms (inclui a etapa
  `liberacoes` — portão de 1.500 ms atendido), 0 falhas.
- 1ª execução pelo schedule (reconciliar, 01:00 UTC 28/09): `ok` nas 3 orgs.

**Recuperação histórica do backfill** (Step 8 do plano de execução, 28/09 ~00:55 UTC):
`{"desde":"2026-09-10T00:00:00Z","ate":"2026-09-28T00:55:00Z"}` → job `backfill-recuperacao`. 3
orgs `ok`; 1.241 vendas regravadas (Avil 955, DSA 200, Daludi Shop 86); 0 falhas, 0 leitura de MP
nula, 0 pendências; 64 mensagens, CPU mediana 223 ms / máx 358 ms. O ML devolveu 429
(`local_rate_limited`) no meio da janela de 18 dias (a etapa relê a janela inteira por lote) e o
retry do QStash absorveu. Nenhuma venda faltava (contagem igual antes/depois, 0 vendas sem itens) —
a recuperação regravou estado/frete/estorno/líquido, não inseriu venda nova.

**Checagem (28/09 01:07 UTC):** 188 shutdowns das 3 funções desde 00:30 UTC, 0 por `CPUTime`. Os 3
`CPUTime` vistos nas 24h anteriores são de antes da ativação.

**Validação (2026-09-30) → Aceito.** O plano previa 3 dias a partir de 01/10; Diego aceitou com
~48 h de produção (28/09 ~00:33 → 30/09 01:16 UTC), critério integral:

- 0 shutdown por `CPUTime` nas 3 funções. `cpu_time_used` máx: reconciliar 493 ms (mediana 119),
  pulse 158 ms, backfill sem shutdown registrado na janela — teto é 2.000 ms, portão da etapa
  `liberacoes` (1.500 ms) atendido.
- `worker_rodadas`: todas as rodadas das 4 orgs (a Hairflay entrou sozinha, sem configuração) em `ok`,
  nenhuma `rodando` com posse vencida.
- `worker_pendencias`: 0 ativas, 0 descartadas.
- 0 notificação duplicada por `(user_id, chave)`; 0 venda sem itens desde 10/09.
- Os HTTP 500 residuais do reconciliar (10 em 48 h) são 429 do ML (`/orders local_rate_limited`) num
  lote; o retry do QStash reprocessou e a rodada fechou `ok`.

Correções vizinhas achadas durante a validação (não mudam esta decisão): dedupe de notificação sem
ERROR 23505 no log (`367bfde8`) e claims de COMPRA fora do reconciliar/backfill/`sync-devolucao`
(`561627d6`) — ver `docs/TASKS.md`.

**Rollback:** `supabase secrets unset FANOUT_X` volta o disparador ao caminho legado no próximo
schedule; mensagens `MsgOrg` já na fila seguem sendo consumidas pelo código novo (que permanece
deployado) — nunca redeployar versão sem a guarda de `MsgOrg`.

**Follow-ups (não bloqueiam):** pack de mensagens com 5xx permanente trava a etapa `mensagens` da
org até o próximo ciclo; pedido com leitura do MP nula e sem pendência prévia não é retentado depois
de sair da janela de 72h (reconciliar e backfill — ver Ruling 14 acima); teste de concorrência
`supabase/tests/worker_rodadas_concorrencia.sh` usa `sleep 1` (pode oscilar); contagem de descarte
pode dobrar se um lote for refeito; `contaExternaId` não numérico vira `"NaN"` no frete do Pulse;
`materializar-metricas` sem schedule em produção (0 invocações em 7 dias até 27/09, fora do escopo
deste ADR).

## Alternativas descartadas

- **Só reduzir `LIMITE_MS`/`ORCAMENTO_MS`:** medem relógio; o limite que estoura é de CPU.
- **Só fan-out, sem lotes:** a Avil sozinha já roda perto de 2 s de CPU no Pulse; qualquer crescimento
  volta a estourar.
- **Outro runtime (worker fora do Supabase):** resolve CPU, mas cria infraestrutura nova para operar,
  sem necessidade enquanto os lotes couberem.
- **Schedule por org:** exigiria criar e apagar schedules a cada org nova.
