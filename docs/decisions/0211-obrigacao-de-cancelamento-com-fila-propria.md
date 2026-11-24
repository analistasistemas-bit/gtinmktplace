# ADR-0211 — Obrigação de cancelamento com fila própria, armada pelo banco

**Status:** Proposto (2026-11-24). Só desenho: nenhum código, migration ou deploy feito.
**Decisores:** Diego
**Refina:** [ADR-0121](0121-cancelamento-tratado-tambem-pela-reconciliacao.md) (quem chama o tratamento de cancelamento). As decisões 2 e 3 (quando repor) **não mudam**.
**Relaciona:** [ADR-0173](0173-fanout-por-org-workers-agendados-cpu.md) (fan-out, `worker_pendencias`), [ADR-0200](0200-kit-com-variacao.md) (pendência `obrigatoria`, baixa adiada), ADR-0094 D-7/D-19 (allowlist de pré-despacho, tombstone `cancelamento_sem_baixa`), ADR-0043 (migrations por canal único).
**Plano:** `docs/superpowers/plans/2026-11-24-backfill-cancelamento-fila-propria.md`
**Classificação:** CRÍTICA (migration + caminho de estoque). Revisão independente obrigatória antes do merge.

## Contexto

`tratarPedidoCancelado` (`_shared/estoque/cancelamento.ts`) repõe o estoque de pedido cancelado antes do despacho e avisa nos demais casos. Ele só roda quando alguém o chama. Hoje chamam: `sync-venda` (webhook) e `reconciliar-faturamento` (claims e vendas das últimas 72h, de hora em hora).

Cinco caminhos gravam `status='cancelled'` em `ml_vendas` pelo `upsertVenda`. Dois deles não chamam o tratamento:

| Quem grava | Trata o cancelamento? |
|---|---|
| `sync-venda` (webhook) | sim |
| `reconciliar-faturamento` (claims, vendas 72h, pendências) | sim |
| `sync-devolucao` | não (o claim volta pelo reconciliar) |
| `backfill-faturamento` agendado (1×/dia, janela de 7 dias, fan-out por org) | **não** |
| `backfill-faturamento` manual (botão Sincronizar) | **não** |

Cancelamento que chega mais de 72h depois da compra, sem claim e sem webhook, só é visto pelo backfill. O estoque fica baixado, sem estorno e sem aviso.

Medido em produção em 24/11/2026 (consulta do plano, seção Reparo do acervo): 389 pedidos cancelados com baixa e sem estorno em 5 orgs (294 na maior), 78 deles sem aviso. Em 23/11 eram 385 e 78; 74 dos 78 vieram por este caminho.

Duas tentativas de correção foram reprovadas na revisão (branches `worktree-agent-aa13c2aa3a4053bb6` e `fix-backfill-cancelamento-central`, não mergeadas). Os 8 motivos estão em Alternativas rejeitadas. A causa comum: a obrigação era gravada **pelo código do backfill**, em uma escrita separada da venda, **na fila de outra coisa** (`worker_pendencias`, que guarda falha de upsert e obrigação de kit).

Fatos do banco conferidos em 24/11/2026:

- `worker_pendencias`: PK `(org_id, order_id)`, colunas `tentativas`, `ultimo_erro`, `descartado_em`, `obrigatoria`. Uma linha por pedido para todos os significados. Vazia hoje.
- `ml_vendas`: só `service_role` escreve (RLS com política apenas de `SELECT`). Único trigger: `ml_vendas_org_default` (before insert). `raw` e `org_id` nunca nulos (10.541 linhas).
- `raw->>'status'` é o status que o ML mandou. Bate com a coluna `status` em 10.540 linhas. A exceção é um pedido que `marcarConversaCancelada` marcou `cancelled` na coluna antes de o ML cancelar.
- `registrar_pendencias_pedido` e `registrar_pendencia_kit`: dono `postgres`, `security definer`, `search_path=''`, execute só para `service_role`.

## Decisão

**1. A obrigação tem tabela própria: `ml_cancelamentos_pendentes`.** PK `(org_id, order_id)`. Colunas: `armada_em`, `tentativas`, `tentada_em`, `ultimo_desfecho`. Não tem `descartado_em` nem `obrigatoria`. Nenhum código de kit, de baixa adiada ou da fila comum lê esta tabela, e o código novo não lê nem escreve `worker_pendencias`.

**2. Quem arma a obrigação é o banco, na mesma instrução que grava o cancelamento.** Trigger `after update of raw` em `ml_vendas`, com a condição:

```sql
new.raw->>'status' = 'cancelled'
and coalesce(old.raw->>'status', old.status) is distinct from 'cancelled'
```

- Gravar `cancelled` e gravar a obrigação são um ato só. Se a obrigação não grava, o `upsert` falha e a venda continua com o status antigo. O chamador trata como falha de upsert, como já faz hoje.
- Vale para os cinco caminhos de escrita, inclusive o botão Sincronizar, sem mudar nenhum deles.
- `after update`, nunca `insert`: venda que o app nunca viu e já chega cancelada não arma nada.
- Compara `raw` (o que o ML disse), não a coluna `status`. `marcarConversaCancelada` não mexe em `raw`, então não arma obrigação falsa nem esconde a transição real que vem depois.
- Rearmar (o pedido voltou a outro status e cancelou de novo) zera `tentativas` e renova `armada_em`.

**3. Quem trata é o `reconciliar-faturamento`, em etapa nova `cancelamentos`.** Ordem: `pendencias → cancelamentos → perguntas → …`. A etapa:

1. Lê até 20 obrigações da org com `armada_em` há mais de 5 minutos, da menos recentemente tentada para a mais recente (`tentada_em` nulo primeiro).
2. Para cada uma: relê o pedido no ML, grava a venda e chama `tratarPedidoCancelado`, com o mesmo enriquecimento da etapa de pendências (frete, envio, MP, catálogo, GTIN).
3. Grava o desfecho numa RPC só (`registrar_cancelamentos_tratados`): apaga as concluídas, soma tentativa nas outras.

Roda **um lote por rodada**, sem cursor. Como a leitura ordena por `tentada_em`, obrigação com erro permanente vai para o fim e não trava as demais.

**4. Concluir é lista fechada.** A obrigação só é apagada com desfecho `reposto`, `avisado`, `sem-baixa`, `silenciado` ou `ignorado`. Qualquer outro (`erro`, `pendente`, `repetir`, exceção, pedido que não leu, desfecho novo que alguém criar) mantém a obrigação. A função `desfechoKit` não participa.

`ignorado` conclui porque significa que o ML não diz mais `cancelled`. A venda acabou de ser regravada com o status atual do ML, então um cancelamento futuro é uma transição nova e rearma pelo trigger.

A leitura do Mercado Pago não entra na conta: esta obrigação é de estoque e aviso. O estorno financeiro continua nos caminhos de hoje.

**5. A obrigação não é descartada.** Fica até concluir. A rodada do reconciliar termina `parcial` enquanto houver obrigação que não concluiu no lote. Obrigação parada aparece na consulta de verificação do plano.

**6. A exclusão é protegida contra rearme.** A RPC só apaga obrigação com `armada_em` anterior ao início da tentativa. Se o pedido rearmou durante o lote, a linha fica.

**7. Sem rajada no deploy.** A tabela nasce vazia e a migration não a preenche. O trigger só vê transição futura. Os 389 pedidos do acervo já estão `cancelled` em `raw`, então nunca armam. O teto de 20 por org por hora limita o efeito de uma sincronização manual de janela longa.

**8. O que não é tocado.** `backfill-faturamento` (index e passo), `_shared/estoque/cancelamento.ts`, `reconciliar-faturamento/kit.ts`, `_shared/faturamento/pendencias.ts`, `worker_pendencias` e suas RPCs, RPCs de estoque. Só o `reconciliar-faturamento` é deployado.

**9. Permissões.** Tabela: RLS ligada, política de `SELECT` por org para `authenticated` (igual a `worker_pendencias`), `revoke all` de `anon` e `authenticated` antes do `grant select` (o Supabase concede tudo por padrão em tabela nova). Função do trigger e RPC: `security definer`, `search_path=''`, dono `postgres`, `revoke all` de `public`, `anon`, `authenticated`; execute da RPC só para `service_role`. Nenhuma RPC de estoque é criada ou alterada, então `estoque_rpc_executor` não entra. Se a implementação precisar trocar o dono de alguma função, vale a regra da casa: `revoke`/`grant` antes do `alter function … owner`.

## Por que tabela, e não tipo ou coluna

| Opção | Por que não |
|---|---|
| Coluna `tipo` em `worker_pendencias` | A PK é `(org_id, order_id)`: o pedido teria uma linha só para falha de upsert, obrigação de kit e cancelamento. Cinco leitores e escritores (`lerPendencias`, `lerPendenciasKit`, `temPendenciaAtiva`, as duas RPCs) precisariam do filtro novo. Um filtro esquecido repete o bloqueio 4 ou o 5. |
| Coluna em `ml_vendas` | Atômica por construção, mas a fila precisa de tentativa, último desfecho e ordem de tentativa (3 colunas a mais numa linha que 5 caminhos regravam inteira). A chave única de `ml_vendas` é `(user_id, order_id)` e a fila é por org. E ainda precisaria do trigger para detectar a transição. |
| RPC única "gravar venda" em transação | Reescreve o gravador usado por 5 caminhos. O trigger dá a mesma atomicidade sem tocar em nenhum. |
| **Tabela dedicada + trigger** | Escolhida. Uma tabela pequena, um trigger, uma RPC, uma etapa. |

## Alternativas rejeitadas (os 8 bloqueios das tentativas anteriores)

| # | O que foi tentado | Por que falha | Como este desenho evita |
|---|---|---|---|
| 1 | Tratar o cancelamento dentro do backfill | Se o tratamento falha, a transição se perde: a janela de 7 dias anda e o cursor do fan-out avança | O backfill não trata. A obrigação nasce com o `cancelled` e fica na tabela até concluir, sem janela nem cursor |
| 2 | `desfechoKit` como juiz do desfecho | Classificava `erro` como ok e apagava a pendência | Lista fechada própria (decisão 4). `desfechoKit` não é chamado nem alterado |
| 3 | Venda inédita já cancelada indo ao tratamento pela fila comum | Em pré-despacho a RPC grava `cancelamento_sem_baixa` para pedido que ninguém decidiu tratar | Trigger só em `update`. A fila nova nunca recebe venda inédita, e o desenho não põe nada na fila comum |
| 4 | Obrigação em linha com `descartado_em` | Linha descartada sai da fila ativa e a obrigação morre calada | Tabela sem descarte. Não há estado "fora da fila" |
| 5 | Reusar `registrar_pendencia_kit` (`obrigatoria`) | Com `kit_variacao` ligado, pedido lido como `paid` vira baixa adiada: `refazerBaixaAdiada` baixa estoque de pedido cancelado | Tabela própria que `lerPendenciasKit` não enxerga. A etapa nova não chama `refazerBaixaAdiada` em nenhum ramo |
| 6 | `throw` da obrigação no lote do fan-out | Falha de upsert de venda `paid` do mesmo lote não chega à fila comum | `backfill-faturamento/passo.ts` não muda. Não há `throw` novo. Falha do trigger é falha de upsert daquele pedido só |
| 7 | `falhasSemFila` contada como enfileirada | A rodada dizia "registrados para o reconciliar" para o que não foi registrado | `falhasSemFila` não existe. O texto e a conta do backfill ficam como na `main` |
| 8 | Aviso "só conta entregue" em `cancelamento.ts` | Abriu corridas: reserva final falhando, Telegram pulado, aviso duplicado na janela de deploy | `cancelamento.ts` fica igual à `main` (decisão do Diego). Limite conhecido em Consequências |

## Consequências

**Aceitas.**

- Todo cancelamento passa a ser tratado duas vezes: uma por quem já tratava (webhook, reconciliar) e outra pela fila, até uma hora depois. É seguro porque o estorno é idempotente por referência e o aviso por `reservarNotificacao` (ADR-0121). Custo: cerca de 4 requisições ao ML por cancelamento.
- Cancelamento tardio é tratado em até cerca de 1h05 depois de o backfill gravar (carência de 5 minutos + ciclo horário).
- **Limite do aviso (decisão do Diego, bloqueio 8).** `tratarPedidoCancelado` reserva o aviso antes de enviar. Se o in-app falhar e o Telegram estiver desligado, o desfecho ainda é `avisado` (ou `silenciado` na vez seguinte), a obrigação conclui e o aviso se perde. Este ADR não muda isso.
- A etapa só existe no caminho com `FANOUT_RECONCILIAR=1` (produção). No caminho legado as obrigações se acumulam sem perda e são tratadas quando o fan-out voltar.
- Venda inédita já cancelada, fora das 72h e sem claim, não entra na fila. Não há o que estornar: a baixa só acontece no `sync-venda`, depois de gravar a venda como paga.
- Comportamento da `main` que continua igual: pedido cancelado cujo upsert **falha** no backfill vai para `worker_pendencias` e o reconciliar o trata ao retomar (inclusive venda inédita). O desenho não amplia nem reduz esse caminho.
- Com `kit_variacao` ligado, `tratarPedidoCancelado` continua podendo gravar a pendência de crédito de kit do ADR-0200 (`pendente`), como já faz quando o reconciliar o chama. Nesse caso as duas obrigações ficam, cada uma na sua tabela, e repetir é idempotente. A etapa nova nunca transforma uma na outra.
- Obrigação que nunca conclui (pedido que o ML não devolve mais, erro permanente) fica na tabela e mantém a rodada `parcial`. Não há alerta automático; a consulta do plano mostra. Alerta entra se a consulta mostrar caso real.

**Não resolve** os 389 pedidos do acervo. O reparo é manual, caso a caso, com conferência física (plano, seção Reparo do acervo). Nenhum estorno em lote.

## Decisões em aberto para o Diego

| Ponto | Proposta (recomendada) | Alternativa |
|---|---|---|
| Tamanho do lote | 20 por org por hora | Outro teto |
| Carência antes da 1ª tentativa | 5 minutos | Zero (trata na rodada seguinte, com mais sobreposição com o webhook) |
| Alerta de obrigação parada | Não criar agora; conferir pela consulta | Aviso ao suporte após N tentativas |
| Caminho legado do reconciliar | Não drena | Drenar também (mais código num caminho desligado) |

## Como reverter

1. Reverter o commit do `reconciliar-faturamento` e redeployar a função. A etapa some; rodada em andamento com cursor `cancelamentos` falha e é reaberta pelo ciclo da hora seguinte.
2. Migration nova com `drop trigger ml_vendas_armar_cancelamento on public.ml_vendas`. A partir daí nada mais arma.
3. A tabela pode ficar (não é lida por ninguém) ou sair na mesma migration. Obrigações pendentes no momento da reversão voltam ao comportamento de hoje: sem tratamento fora das 72h.

A ordem inversa (derrubar o trigger antes da função) também é segura: a etapa passa a ler uma fila que só esvazia.
