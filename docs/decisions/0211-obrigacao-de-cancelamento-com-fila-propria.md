# ADR-0211 — Obrigação de cancelamento com fila própria, armada pelo banco

**Status:** Proposto (2026-11-24, revisão 2). Só desenho: nenhum código, migration ou deploy feito.
**Decisores:** Diego
**Refina:** [ADR-0121](0121-cancelamento-tratado-tambem-pela-reconciliacao.md) (quem chama o tratamento de cancelamento). As decisões 2 e 3 (quando repor) **não mudam**.
**Relaciona:** [ADR-0173](0173-fanout-por-org-workers-agendados-cpu.md) (fan-out, `worker_pendencias`), [ADR-0200](0200-kit-com-variacao.md) (pendência `obrigatoria`, baixa adiada), ADR-0094 D-7/D-19 (allowlist de pré-despacho, tombstone `cancelamento_sem_baixa`), ADR-0043 (migrations por canal único).
**Plano:** `docs/superpowers/plans/2026-11-24-backfill-cancelamento-fila-propria.md`
**Classificação:** CRÍTICA (migration + caminho de estoque). Revisão independente obrigatória antes do merge.

**Revisão 2 (24/11):** o Codex gpt-6.2-sol (high) devolveu REVISE com 5 pontos sobre a revisão 1 (`771ce88d`). O desenho ficou menor. Mudou:

- A fila deixa de ser uma tabela e vira colunas em `ml_vendas`, preenchidas por um trigger que só faz atribuição. O trigger não tem como falhar sozinho.
- A fila **não regrava a venda**. Lê o ledger de estoque para saber o que ainda está baixado e usa os SKUs do ledger.
- Toda confirmação (sucesso ou falha) usa a geração lida da fila.
- Não há valor novo de cursor. A drenagem tem chave de liga/desliga por variável de ambiente.

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

Duas tentativas de correção foram reprovadas (branches `worktree-agent-aa13c2aa3a4053bb6` e `fix-backfill-cancelamento-central`, não mergeadas). Os 8 motivos estão em Alternativas rejeitadas. A causa comum: a obrigação era gravada pelo código do backfill, em escrita separada da venda, na fila de outra coisa (`worker_pendencias`).

Fatos do banco conferidos em 24/11/2026:

- `worker_pendencias`: PK `(org_id, order_id)`, com `descartado_em` e `obrigatoria`. Uma linha por pedido para todos os significados. Vazia hoje.
- `ml_vendas`: só `service_role` escreve (RLS com política apenas de `SELECT` por org). Único trigger: `ml_vendas_org_default`. Chave única `(user_id, order_id)`. `raw` e `org_id` nunca nulos (10.542 linhas).
- `raw->>'status'` é o status que o ML mandou. Diverge da coluna `status` em 1 linha (pedido que `marcarConversaCancelada` marcou antes de o ML cancelar).
- `raw->>'last_updated'` e `raw->'seller'->>'id'` existem em todas as linhas.
- Ledger: 6 movimentos `estorno_venda` (quantidade > 0) e 112 `cancelamento_sem_baixa` (quantidade 0), os dois com referência `estorno:<ref da venda>`. Existe ainda `estorno_sku_nao_encontrado` (quantidade 0). Só o primeiro devolve saldo.

## Decisão

**1. A obrigação mora em colunas próprias de `ml_vendas`.** Sete colunas `cancelamento_*`: `geracao` (uuid), `armado_em`, `lote`, `tentativas`, `tentado_em`, `desfecho`, `concluido_em`. Pendente = `geracao` preenchida e `concluido_em` nulo. Nenhum código de kit, de baixa adiada ou da fila comum lê essas colunas. O código novo não lê nem escreve `worker_pendencias`.

**2. Quem arma é o banco, por atribuição.** Trigger `before update of raw` em `ml_vendas`, disparado quando `raw->>'status'` entra em `cancelled` ou sai dele:

- Entrou em `cancelled`: gera `geracao` nova, grava `armado_em`, zera o resto.
- Saiu de `cancelled` com obrigação pendente: marca `concluido_em` com desfecho `desarmado`. Só desarma se o `last_updated` do registro novo não for mais antigo que o do anterior (leitura velha de `paid` não apaga obrigação).

Consequências dessa forma:

- O trigger só altera a própria linha que está sendo gravada. Não escreve em outra tabela, então não cria modo de falha novo no `upsert` de ninguém, inclusive o do botão Sincronizar.
- Gravar `cancelled` e armar são a mesma escrita de linha.
- Vale para os cinco caminhos sem mudar nenhum deles.
- Só `update`: venda que o app nunca viu e já chega cancelada não arma.
- Olha `raw`, não a coluna `status`: `marcarConversaCancelada` não arma nem esconde a transição real.

**3. Quem trata é o `reconciliar-faturamento`, sem etapa nova de cursor.** A drenagem roda na execução em que a etapa `pendencias` encontra a fila comum vazia, antes de seguir para `perguntas`. Os valores de cursor continuam os de hoje, então um binário antigo nunca recebe cursor desconhecido.

- Liga por variável de ambiente `DRENAR_CANCELAMENTOS` (`1` = todas as orgs; lista de ids = só essas). Sem a variável, nada drena e as obrigações ficam guardadas.
- A drenagem nunca lança: erro vira log e `parcial` na rodada, e as etapas seguintes rodam.

**4. O lote é fixado por ciclo.** A RPC `reivindicar_cancelamentos` marca até 20 obrigações da org com a chave do ciclo (`params.ate`, gravado na abertura do ciclo) e devolve as marcadas ainda não concluídas. Uma repetição da mesma execução (falha no avanço do cursor) recebe os mesmos pedidos, nunca outros 20. Entra na fila quem tem `armado_em` há mais de 5 minutos, do menos recentemente tentado para o mais recente.

**5. A fila decide pelo ledger e não regrava a venda.** Para cada obrigação do lote:

1. **Ledger.** Lê as baixas do pedido (`motivo='venda'`, quantidade < 0, referência `mercado_livre:<pedido>:<sku>`) e quais têm estorno efetivo (`estorno_venda` com quantidade > 0). Sem baixa aberta → conclui `sem-baixa-aberta`, sem chamar o ML nem o estoque.
2. **ML.** Com baixa aberta, relê pedido e envio. Só segue se: o id bate, o vendedor é o da conexão, o status é `cancelled` e o `last_updated` da resposta não é mais antigo que o gravado. Senão, fica pendente.
3. **Geração.** Confere de novo, logo antes de tratar, que a geração lida ainda está pendente.
4. **Tratamento.** Chama `tratarPedidoCancelado` com os itens **do ledger** (uma entrada por baixa aberta), não com SKUs resolvidos de novo. O código usado é o sufixo da referência da baixa, que é o que a RPC de estorno procura. Em venda de kit ele difere da coluna `codigo` do movimento, que guarda o componente (21 movimentos em produção).
5. **Conferência.** Depois de `reposto`, relê o ledger: só conclui se não sobrou baixa aberta.

**6. Concluir é lista fechada, na camada da fila.**

| Situação | Desfecho gravado | Conclui? |
|---|---|---|
| Sem baixa aberta no ledger | `sem-baixa-aberta` | sim |
| `reposto` e ledger sem baixa aberta | `reposto` | sim |
| `reposto` com baixa ainda aberta (RPC falhou para um SKU, SKU sumiu) | `reposicao-incompleta` | não |
| `avisado` ou `silenciado` | o próprio | sim |
| Parte já estornada, parte aberta, e o envio não é mais pré-despacho | `parcial-sem-pre-despacho` (não chama o tratamento) | não |
| ML não confirmou (leitura falhou, id/vendedor errado, status não `cancelled`, resposta velha) | `ml: <motivo>` | não |
| `erro`, `pendente`, `repetir`, `sem-baixa`, `ignorado`, exceção, desfecho novo | o próprio | não |

`desfechoKit` não participa. `cancelamento.ts` não muda: a lista vive no arquivo novo da fila.

**7. Toda confirmação usa a geração.** A RPC `registrar_cancelamentos_tratados` só altera a linha cuja `geracao` é a que a fila leu e que ainda está pendente. Rearme no meio do lote: nem conclui nem soma tentativa na geração nova.

**8. Crédito de kit fica na fila própria.** A fila chama o tratamento com as dependências de produção, trocando só `registrarPendenciaKit` por uma função vazia. Falha no crédito de kit devolve `pendente`, a obrigação continua nas colunas novas e nada é gravado em `worker_pendencias`. As baixas adiadas legítimas do ADR-0200 não são tocadas.

**9. A obrigação não é descartada.** Fica até concluir ou desarmar. Rodada com obrigação não concluída termina `parcial`.

**10. Sem rajada no deploy.** As colunas nascem nulas e a migration não as preenche. Os 388 pedidos do acervo já estão `cancelled` em `raw` e nunca armam.

**11. O que não é tocado.** `backfill-faturamento`, `_shared/estoque/` (inclui `cancelamento.ts` e `baixa.ts`), `reconciliar-faturamento/kit.ts`, `_shared/faturamento/pendencias.ts` e `io.ts`, `_shared/rodada/`, `worker_pendencias` e suas RPCs, RPCs de estoque. Só o `reconciliar-faturamento` é deployado.

**12. Permissões.** Função do trigger: `security invoker` (só atribui em `new`), `search_path=''`. As duas RPCs: `security definer`, `search_path=''`, dono `postgres`, `revoke all` de `public`, `anon`, `authenticated`, execute só para `service_role`. Sem tabela nova, as colunas herdam a RLS de `ml_vendas`. Nenhuma RPC de estoque é criada ou alterada, então `estoque_rpc_executor` não entra. Se a implementação precisar trocar dono de função: `revoke`/`grant` antes do `alter function … owner`.

**13. Parâmetros aprovados pelo Diego (24/11):** lote de 20 por org por hora, carência de 5 minutos, sem alerta novo de obrigação parada, caminho legado do reconciliar não drena.

## Por que colunas em `ml_vendas`

| Opção | Por que não |
|---|---|
| Coluna `tipo` em `worker_pendencias` | PK `(org_id, order_id)`: o pedido teria uma linha só para falha de upsert, kit e cancelamento. Cinco leitores e escritores precisariam do filtro novo; um esquecido repete o bloqueio 4 ou o 5 |
| Tabela dedicada preenchida por trigger (revisão 1) | O `insert` do trigger pode falhar e derrubar o `upsert` da venda. No botão Sincronizar essa falha só é contada, sem retentativa. Exige RLS, grants e política próprios |
| RPC única "gravar venda" em transação | Reescreve o gravador usado por 5 caminhos |
| **Colunas na própria venda + trigger de atribuição** | Escolhida. A obrigação é parte da linha que grava o `cancelled`: não há segunda escrita para falhar. Custo: 7 colunas nulas em `ml_vendas` e um índice parcial |

## Alternativas rejeitadas (os 8 bloqueios das tentativas anteriores)

| # | O que foi tentado | Por que falha | Como este desenho evita |
|---|---|---|---|
| 1 | Tratar o cancelamento dentro do backfill | Se o tratamento falha, a transição se perde: a janela anda e o cursor avança | O backfill não trata. A obrigação é parte da linha da venda e fica até concluir |
| 2 | `desfechoKit` como juiz do desfecho | Classificava `erro` como ok e apagava a pendência | Lista fechada própria (decisão 6), conferida no ledger |
| 3 | Venda inédita já cancelada indo ao tratamento pela fila comum | Em pré-despacho a RPC grava `cancelamento_sem_baixa` para pedido que ninguém decidiu tratar | Trigger só em `update`. Além disso a fila só chama o estoque quando o ledger mostra baixa aberta, então nunca grava tombstone |
| 4 | Obrigação em linha com `descartado_em` | Linha descartada sai da fila ativa | Não existe descarte |
| 5 | Reusar `registrar_pendencia_kit` | Pedido lido como `paid` vira baixa adiada e baixa estoque de pedido cancelado | Colunas que o código de kit não lê; `registrarPendenciaKit` neutralizado na fila (decisão 8); a fila não chama `refazerBaixaAdiada` |
| 6 | `throw` da obrigação no lote do fan-out | Venda `paid` do mesmo lote perde a fila comum | O backfill não muda e o trigger não falha sozinho |
| 7 | `falhasSemFila` contada como enfileirada | A rodada dizia "registrados" para o que não foi | Não existe. Conta e texto do backfill ficam como na `main` |
| 8 | Aviso "só conta entregue" em `cancelamento.ts` | Corridas: reserva final falhando, Telegram pulado, aviso duplicado no deploy | `cancelamento.ts` fica igual à `main` (decisão do Diego) |

## Consequências

**Aceitas.**

- Cancelamento tardio é tratado em até cerca de 1h05 depois de gravado.
- Cancelamento já tratado pelo webhook ou pelo reconciliar custa à fila uma leitura do ledger e mais nada.
- **Limite do aviso (decisão do Diego).** `tratarPedidoCancelado` reserva o aviso antes de enviar. Se o in-app falhar e o Telegram estiver desligado, o desfecho ainda é `avisado` ou `silenciado`, a obrigação conclui e o aviso se perde.
- **Janela residual de leitura velha.** A conferência de versão e de geração acontece logo antes do tratamento, mas não na mesma transação da RPC de estoque. Um `paid` mais novo que chegue nesse intervalo não impede o estorno já iniciado. É a mesma exposição que `sync-venda` e reconciliar têm hoje; fechá-la exige mudar a RPC de estoque, fora deste ADR.
- Obrigação que o ML insiste em não confirmar como `cancelled` fica pendente até alguém regravar a venda com status mais novo (desarma) ou até investigação (consulta V5 do plano). Não há alerta automático.
- Com a variável desligada ou no caminho legado, as obrigações se acumulam sem perda.
- O teto é de 20 **pedidos distintos** por org por ciclo. Os que falharam podem ser reprocessados na repetição da mesma execução.
- Comportamento da `main` que continua igual: pedido cancelado cujo upsert falha no backfill agendado vai para `worker_pendencias` e o reconciliar o trata ao retomar. No botão Sincronizar a falha de upsert segue só contada, como hoje.

**Achado fora do escopo (existe na `main`).** Nos caminhos que já tratam (webhook, reconciliar 72h), `houveBaixaDeVenda` olha só a baixa original. Pedido estornado em pré-despacho e revisitado depois, com o envio já `cancelled`, recebe o aviso "estoque NÃO reposto". A fila nova não tem esse problema (decide pelo ledger). Corrigir os caminhos antigos é mudança em `baixa.ts`, a decidir à parte.

**Não resolve** os 388 pedidos do acervo. O reparo é manual, caso a caso, com conferência física (plano, seção Reparo do acervo).

## Como reverter

1. **Sem deploy:** remover `DRENAR_CANCELAMENTOS`. A drenagem para na rodada seguinte; as obrigações ficam guardadas; o resto do reconciliar não muda.
2. **Código:** reverter o commit do `reconciliar-faturamento` e redeployar. Não há cursor novo, então a rodada em andamento continua com o binário antigo.
3. **Banco:** migration nova com `drop trigger ml_vendas_cancelamento_fila on public.ml_vendas`. As colunas podem ficar (ninguém lê) ou sair depois.

Qualquer ordem é segura: sem a função, o trigger só arma; sem o trigger, a drenagem lê uma fila que só esvazia; função deployada antes da migration registra erro na drenagem e segue.
