# ADR-0211 — Obrigação de cancelamento com fila própria, armada pelo banco

**Status:** Aceito (2026-11-24). Implementação na branch `feat/adr-0211-fila-cancelamento`; migration aplicada, deploy, ensaio (6.2), canário (6.3) e medição ainda pendentes.
**Decisores:** Diego
**Refina:** [ADR-0121](0121-cancelamento-tratado-tambem-pela-reconciliacao.md) (quem chama o tratamento de cancelamento). As decisões 2 e 3 (quando repor) **não mudam**.
**Relaciona:** [ADR-0173](0173-fanout-por-org-workers-agendados-cpu.md) (fan-out, `worker_pendencias`), [ADR-0200](0200-kit-com-variacao.md) (pendência `obrigatoria`, baixa adiada), ADR-0094 D-7/D-19 (allowlist de pré-despacho, tombstone `cancelamento_sem_baixa`), ADR-0043 (migrations por canal único).
**Plano:** `docs/superpowers/plans/2026-11-24-backfill-cancelamento-fila-propria.md`
**Classificação:** CRÍTICA (migration + caminho de estoque). Revisão independente obrigatória antes do merge.

**Histórico de revisão** (Codex gpt-6.2-sol, high):

| Revisão | Veredito anterior | O que mudou |
|---|---|---|
| 1 (`771ce88d`) | — | Tabela dedicada + trigger + etapa nova de cursor |
| 2 (`84afe109`) | REVISE, 5 pontos | Fila em colunas de `ml_vendas`; a drenagem não regrava a venda e decide pelo ledger; confirmação por geração; sem cursor novo |
| 3 (`d4041a3d`) | REVISE, 5 pontos | O trigger só arma, nunca desarma; só a drenagem conclui, com leitura do ML ao vivo; baixa posterior reabre a obrigação; SKU com `:` corrigido; teto de 20 exato; ensaio SQL fora das tabelas reais |
| 4 (`abad948e`) | REVISE, 5 pontos | `cancelled` mais novo renova a geração; só o ciclo corrente reivindica; prazos na drenagem; ensaio sem dado de cliente e sem exclusão no ledger; grupo A do reparo só com contagem confirmada |
| 5 | REVISE, 5 pontos | Envio não lido deixa pendente; toda espera da drenagem tem prazo; ensaio aguarda a margem; grupo A exige a unidade contada; reversão mantém o trigger |
| 6 (implementação) | ressalvas a/b/c da rodada 5 + decisões do Diego | Ensaio com uma org por cenário; prazos contados do início da execução e `registrar` sem resposta = incerto; `nao-cancelado` exige `status` presente; remover o trigger deixa de ser rollback |

## Contexto

`tratarPedidoCancelado` (`_shared/estoque/cancelamento.ts`) repõe o estoque de pedido cancelado antes do despacho e avisa nos demais casos. Ele só roda quando alguém o chama. Hoje chamam: `sync-venda` (webhook) e `reconciliar-faturamento` (claims e vendas das últimas 72h, de hora em hora).

Cinco caminhos gravam `cancelled` em `ml_vendas` pelo `upsertVenda`. Três não chamam o tratamento:

| Quem grava | Trata o cancelamento? |
|---|---|
| `sync-venda` (webhook) | sim |
| `reconciliar-faturamento` (claims, vendas 72h, pendências) | sim |
| `sync-devolucao` | não (o claim volta pelo reconciliar) |
| `backfill-faturamento` agendado (1×/dia, janela de 7 dias, fan-out por org) | **não** |
| `backfill-faturamento` manual (botão Sincronizar) | **não** |

Cancelamento que chega mais de 72h depois da compra, sem claim e sem webhook, só é visto pelo backfill. O estoque fica baixado, sem estorno e sem aviso.

Medido em produção em 24/11/2026 (consulta V0 do plano): 388 pedidos cancelados com baixa e sem estorno efetivo em 5 orgs, 77 deles sem aviso. Em 23/11, por outra consulta, eram 385 e 78; 74 dos 78 vieram por este caminho.

Duas tentativas de correção foram reprovadas (branches `worktree-agent-aa13c2aa3a4053bb6` e `fix-backfill-cancelamento-central`, não mergeadas). Os 8 motivos estão em Alternativas rejeitadas.

Fatos conferidos em 24/11/2026:

- `worker_pendencias`: PK `(org_id, order_id)`, com `descartado_em` e `obrigatoria`. Vazia hoje.
- `ml_vendas`: só `service_role` escreve (RLS com política apenas de `SELECT` por org). Único trigger: `ml_vendas_org_default`. `raw` e `org_id` nunca nulos (10.542 linhas). `raw->>'last_updated'` e `raw->'seller'->>'id'` existem em todas.
- `upsertVenda` sobrescreve `raw` sem comparar versões. Por isso `raw` não serve como "último estado verdadeiro": uma leitura velha pode regravá-lo.
- `raw->>'status'` diverge da coluna `status` em 1 linha (`marcarConversaCancelada` grava só a coluna).
- Ledger: referência da baixa é `mercado_livre:<pedido>:<código>`. Em 21 movimentos (venda de kit) a coluna `codigo` guarda o componente e difere do código da referência. Estorno efetivo é `estorno_venda` com quantidade > 0 (6 linhas); `cancelamento_sem_baixa` (112) e `estorno_sku_nao_encontrado` têm quantidade 0.
- `sync-venda` grava a venda e faz a baixa em operações separadas. Uma leitura velha `paid` pode baixar estoque de pedido já cancelado.

## Princípio

Três regras, cada uma eliminando uma classe de problema:

1. **O banco só arma.** O trigger nunca conclui nem desarma. Cada `cancelled` mais novo que ele vê troca a geração, e conclusão feita com geração antiga não vale.
2. **Só a drenagem conclui, e só com duas evidências lidas na hora:** o ledger de estoque e a resposta do ML ao vivo.
3. **Concluir não é definitivo.** Baixa que apareça depois da conclusão reabre a obrigação.

## Decisão

**1. A obrigação mora em colunas próprias de `ml_vendas`.** Oito colunas `cancelamento_*`: `geracao` (uuid), `versao` (o `last_updated` do registro que armou), `armado_em`, `lote`, `tentativas`, `tentado_em`, `desfecho`, `concluido_em`. Pendente = `geracao` preenchida e `concluido_em` nulo. Nenhum código de kit, de baixa adiada ou da fila comum lê essas colunas. O código novo não lê nem escreve `worker_pendencias`.

**2. O trigger só arma ou renova a geração, por atribuição.** `before update of raw` em `ml_vendas`, em toda gravação com `raw->>'status'` = `cancelled` (inclusive `cancelled → cancelled`):

| Estado da linha | Gravação | Efeito |
|---|---|---|
| Nunca armada | passou de outro status para `cancelled` | arma: geração, `versao`, `armado_em` |
| Nunca armada | já era `cancelled` (acervo) | nada |
| Armada (pendente ou concluída) | `cancelled` com versão **maior** que a guardada | geração e `versao` novas. Se estava concluída, volta a pendente; se estava pendente, mantém tentativas e `armado_em` |
| Armada | `cancelled` com versão igual ou menor | nada |

A versão é o `last_updated` do `raw`, comparado como texto. Em produção o formato é único nas 10.543 linhas (29 caracteres, `.000-04:00`), então a ordem do texto é a ordem do tempo. Se um dia o formato variar, o pior efeito é não reconhecer um `cancelled` mais novo; a drenagem continua exigindo a resposta ao vivo.

O trigger só altera a linha que está sendo gravada, sem conversão de tipo e sem escrever em outra tabela. Não cria modo de falha novo no `upsert` de ninguém. Só `update`: venda inédita já cancelada não arma. Olha `raw`, não a coluna `status`. Não mexe em `lote`.

**3. A drenagem roda no `reconciliar-faturamento`, sem etapa nova de cursor.** Roda na execução em que a etapa `pendencias` encontra a fila comum vazia, antes de `perguntas`. Liga por `DRENAR_CANCELAMENTOS` (`1` = todas as orgs; lista de ids = só essas). Nunca lança: erro vira log e `parcial`. Não roda em conexão sem `contaExternaId` (sem ela não dá para conferir o vendedor). Toda espera tem prazo: 10 s por leitura do ML e por RPC, 30 s pelo tratamento. Os prazos contam do **início da execução** (antes de conexão, token e leitura das pendências), não do início da drenagem: só começa obrigação nova até 60 s (ajustável por `DRENAR_CANCELAMENTOS_PRAZO_MS`); aos 100 s para de esperar, grava o que tem (até 10 s) e devolve, contra 150 s de posse da rodada. O que não começou, ou ficou com resultado incerto, segue pendente e o ciclo seguinte reconfere pelo ledger. `registrar` sem resposta no prazo também é incerto (pode ter gravado depois): a drenagem lança, a rodada sai `parcial` e o ciclo seguinte começa pelo ledger.

**4. O lote é fixado por ciclo e o teto é exato.** A RPC `reivindicar_cancelamentos`, sob trava por org, marca `lote` = chave do ciclo (`params.ate`) em até `20 − (linhas da org já marcadas com essa chave)` obrigações. Nada apaga `lote` durante o ciclo: nem concluir, nem rearmar, nem reabrir. Logo, no máximo 20 vendas distintas por org por ciclo, quantas vezes a execução se repetir. A RPC só reivindica se a rodada `reconciliar` da org está `rodando` com esse mesmo `params.ate`: execução atrasada de um ciclo anterior sai sem marcar nada. Entra quem tem `armado_em` há mais de 5 minutos, do menos recentemente tentado para o mais recente.

**5. A drenagem decide pelo ledger e pelo ML ao vivo. Não regrava a venda.** Para cada obrigação:

1. **Ledger.** `cancelamento_baixas` devolve as baixas do pedido, quais têm estorno efetivo e o instante da leitura. Sem baixa aberta → conclui `sem-baixa-aberta`, sem chamar ML nem estoque.
2. **ML ao vivo.** Relê pedido e envio. Exige que o id seja o do pedido e o vendedor seja o da conexão. Pedido com envio cujo status não pôde ser lido fica pendente: a fila nunca manda ao tratamento um envio "desconhecido", que cairia no aviso com a baixa pré-despacho aberta. Depois compara status e versão:

| Resposta do ML | Ação |
|---|---|
| `cancelled`, `last_updated` ≥ `versao` armada | segue para o tratamento |
| outro status (texto presente e não vazio), `last_updated` > `versao` armada | conclui `nao-cancelado` (o ML desfez; sem estoque, sem aviso) |
| qualquer outra (mais antiga, sem data, **sem `status`**, leitura falhou, id ou vendedor errado) | fica pendente |

3. **Geração.** Confere, logo antes de tratar, que a geração lida ainda está pendente.
4. **Tratamento.** `tratarPedidoCancelado` com os itens **do ledger**, uma entrada por baixa aberta. O código é a referência da baixa sem o prefixo `mercado_livre:<pedido>:`, inteiro, mesmo que contenha `:`. É o que a RPC de estorno procura.
5. **Conferência.** Depois de `reposto`, relê o ledger: só conclui se não sobrou baixa aberta.

**6. Concluir é lista fechada, na camada da fila.**

| Situação | Desfecho | Conclui? |
|---|---|---|
| Sem baixa aberta | `sem-baixa-aberta` | sim |
| ML ao vivo diz outro status, mais novo | `nao-cancelado` | sim |
| `reposto` e ledger sem baixa aberta | `reposto` | sim |
| `reposto` com baixa ainda aberta | `reposicao-incompleta` | não |
| `avisado` ou `silenciado` | o próprio | sim |
| Parte estornada, parte aberta, e o envio não é mais pré-despacho | `parcial-sem-pre-despacho` (não chama o tratamento) | não |
| ML não confirmou, ou o envio não pôde ser lido | `ml: <motivo>` | não |
| Tratamento não respondeu no prazo | `tratamento: tempo esgotado` | não |
| `erro`, `pendente`, `repetir`, `sem-baixa`, `ignorado`, exceção, desfecho novo | o próprio | não |

`cancelamento.ts` não muda; a lista vive no arquivo da fila. `desfechoKit` não participa.

**7. Toda confirmação usa a geração.** `registrar_cancelamentos_tratados` só altera a linha cuja `geracao` é a lida e que ainda está pendente. `concluido_em` recebe o instante da leitura do ledger que justificou a conclusão.

**8. Baixa posterior reabre.** No início de cada reivindicação, a RPC reabre (geração nova) toda obrigação concluída da org que tenha baixa aberta criada depois de `concluido_em` menos 5 minutos de margem. Cobre a leitura velha `paid` do `sync-venda` que baixa estoque depois de a fila concluir. A baixa antiga de um pedido `avisado` não reabre, porque é anterior à conclusão.

**9. Crédito de kit fica na fila própria.** A drenagem chama o tratamento com as dependências de produção, trocando só `registrarPendenciaKit` por função vazia. Falha no crédito de kit devolve `pendente`, a obrigação continua nas colunas novas e nada é gravado em `worker_pendencias`.

**10. A obrigação não é descartada.** Fica até a drenagem concluir. Rodada com obrigação não concluída termina `parcial`.

**11. Sem rajada no deploy.** As colunas nascem nulas e a migration não as preenche. Os 388 pedidos do acervo já estão `cancelled` em `raw` e nunca armam.

**12. O que não é tocado.** `backfill-faturamento`, `sync-venda`, `_shared/estoque/` (inclui `cancelamento.ts` e `baixa.ts`), `reconciliar-faturamento/kit.ts`, `_shared/faturamento/pendencias.ts`, `io.ts` e `venda.ts`, `_shared/rodada/`, `worker_pendencias`, RPCs de estoque. Só o `reconciliar-faturamento` é deployado.

**13. Permissões.** Função do trigger: `security invoker`, `search_path=''`. As três RPCs: `security definer`, `search_path=''`, dono `postgres`, `revoke all` de `public`, `anon`, `authenticated`, execute só para `service_role`. Sem tabela nova: as colunas herdam a RLS de `ml_vendas`. Nenhuma RPC de estoque é criada ou alterada, então `estoque_rpc_executor` não entra. Se a implementação precisar trocar dono de função: `revoke`/`grant` antes do `alter function … owner`.

**14. Parâmetros aprovados pelo Diego (24/11):** lote de 20 por org por hora, carência de 5 minutos, sem alerta novo de obrigação parada, caminho legado do reconciliar não drena.

## Como as sequências de leitura velha se resolvem

| Sequência de gravações em `raw` | O que acontece |
|---|---|
| `cancelled@30 → cancelled@10 → paid@20` | Armou em @30 (`versao=30`). As duas gravações seguintes não mexem na obrigação. A drenagem lê o ML ao vivo: `cancelled@30` → trata |
| `cancelled@30 → paid@10 → paid@40` | Armou em @30. Nada desarma. A drenagem lê o ML ao vivo: `paid@40` > 30 → conclui `nao-cancelado` |
| Fila lê `paid` velho do ML enquanto o webhook confirma `cancelled` | A fila não grava venda. `paid` com data ≤ `versao` → fica pendente e tenta no ciclo seguinte |
| `sync-venda` com leitura velha `paid` baixa estoque depois de a fila concluir | A reivindicação seguinte vê baixa aberta posterior à conclusão e reabre |
| Fila lê `paid@40` para obrigação armada em @30; antes de concluir, o backfill grava `cancelled@50` | O trigger troca a geração. O registro `nao-cancelado` com a geração antiga não altera nada. No ciclo seguinte a `versao` é @50 |

## Por que colunas em `ml_vendas`

| Opção | Por que não |
|---|---|
| Coluna `tipo` em `worker_pendencias` | PK `(org_id, order_id)`: uma linha só para falha de upsert, kit e cancelamento. Um filtro esquecido repete o bloqueio 4 ou o 5 |
| Tabela dedicada preenchida por trigger (revisão 1) | O `insert` do trigger pode falhar e derrubar o `upsert` da venda; no botão Sincronizar isso só é contado |
| RPC única "gravar venda" com controle de versão | Resolveria a leitura velha na origem, mas reescreve o gravador usado por 5 caminhos. Aqui a fila deixa de depender de `raw` |
| **Colunas na própria venda + trigger que só arma** | Escolhida. Custo: 8 colunas nulas em `ml_vendas` e um índice parcial |

## Alternativas rejeitadas (os 8 bloqueios das tentativas anteriores)

| # | O que foi tentado | Por que falha | Como este desenho evita |
|---|---|---|---|
| 1 | Tratar o cancelamento dentro do backfill | Se o tratamento falha, a transição se perde | O backfill não trata. A obrigação é parte da linha da venda e fica até concluir |
| 2 | `desfechoKit` como juiz do desfecho | Classificava `erro` como ok | Lista fechada própria, conferida no ledger |
| 3 | Venda inédita já cancelada indo ao tratamento pela fila comum | A RPC grava `cancelamento_sem_baixa` para pedido que ninguém decidiu tratar | Trigger só em `update`. A fila só chama o estoque para baixa aberta do ledger, então nunca grava tombstone |
| 4 | Obrigação em linha com `descartado_em` | Linha descartada sai da fila ativa | Não existe descarte |
| 5 | Reusar `registrar_pendencia_kit` | Pedido lido como `paid` vira baixa adiada | Colunas que o código de kit não lê; `registrarPendenciaKit` neutralizado na fila; a fila não chama `refazerBaixaAdiada` |
| 6 | `throw` da obrigação no lote do fan-out | Venda `paid` do mesmo lote perde a fila comum | O backfill não muda e o trigger não falha sozinho |
| 7 | `falhasSemFila` contada como enfileirada | A rodada dizia "registrados" para o que não foi | Não existe |
| 8 | Aviso "só conta entregue" em `cancelamento.ts` | Corridas no aviso | `cancelamento.ts` fica igual à `main` (decisão do Diego) |

## Consequências

**Aceitas.**

- Cancelamento tardio é tratado em até cerca de 1h05 depois de gravado.
- Cancelamento já tratado pelo webhook ou pelo reconciliar custa à fila uma leitura do ledger.
- **Limite do aviso (decisão do Diego).** `tratarPedidoCancelado` reserva o aviso antes de enviar. Se o in-app falhar e o Telegram estiver desligado, o desfecho ainda é `avisado` ou `silenciado`, a obrigação conclui e o aviso se perde.
- **A fila confia na resposta ao vivo do ML.** Se a própria API devolver um pedido defasado com data igual ou posterior à armada, a fila age sobre ele. Não há fonte melhor; a reabertura por baixa posterior cobre o efeito no estoque de um `paid` que chegue depois.
- **A baixa obsoleta não é impedida, é reparada.** A leitura velha do `sync-venda` ainda baixa; a fila reabre e trata em até uma hora. Impedir na origem exige mudar a RPC de baixa ou o `sync-venda`, fora deste ADR.
- Margem de 5 minutos na reabertura: uma baixa criada nos 5 minutos antes da conclusão de um pedido `avisado` reabre uma vez; o tratamento devolve `silenciado` e conclui de novo. Custo: uma passada a mais.
- A chamada ao ML que estoura o prazo é abandonada, não cancelada (as funções de leitura não aceitam sinal e `io.ts` não muda). Ela termina sozinha, sem efeito.
- Duas execuções do **mesmo** ciclo (posse vencida e retomada) recebem o mesmo lote e podem tratar o mesmo pedido duas vezes. É idempotente e a confirmação é por geração.
- Obrigação que o ML nunca confirma fica pendente até investigação (consulta V5 do plano). Não há alerta automático.
- Com a variável desligada ou no caminho legado, as obrigações se acumulam sem perda.
- A reabertura varre os movimentos de venda da org a cada ciclo. Hoje são poucos milhares por org; o custo entra na medição do plano.
- Comportamento da `main` que continua igual: pedido cancelado cujo upsert falha no backfill agendado vai para `worker_pendencias` e o reconciliar o trata ao retomar. No botão Sincronizar a falha de upsert segue só contada.

**Achado fora do escopo (existe na `main`).** Nos caminhos que já tratam (webhook, reconciliar 72h), `houveBaixaDeVenda` olha só a baixa original. Pedido estornado em pré-despacho e revisitado com o envio já `cancelled` recebe o aviso "estoque NÃO reposto". A fila nova não tem esse problema. Corrigir os caminhos antigos é mudança em `baixa.ts`, a decidir à parte.

**Não resolve** os 388 pedidos do acervo. O reparo é manual, caso a caso, com conferência física (plano, seção Reparo do acervo).

## Como reverter

1. **Reversão: remover `DRENAR_CANCELAMENTOS`.** Sem deploy. A drenagem para na rodada seguinte e **o trigger continua armando**. Nada se perde: ao religar, a fila trata o que acumulou.
2. **Código:** reverter o commit do `reconciliar-faturamento` e redeployar. Não há cursor novo. O trigger continua.

**Remover o trigger não é opção de rollback (decisão do Diego, 24/11).** Ele só atribui colunas em `new`, sem conversão de tipo e sem escrever em outra tabela: não tem como falhar. Removê-lo abriria uma janela de cancelamentos que nunca rearmam, porque a linha já estaria `cancelled`.

Sem a função, o trigger só arma. Função deployada antes da migration registra erro na drenagem e segue.
