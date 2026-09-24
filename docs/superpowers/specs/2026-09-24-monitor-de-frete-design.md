# Monitor de Frete — design

**Data:** 2026-09-24 · **ADR:** [0169](../../decisions/0169-monitor-de-frete.md) · **Origem:** roadmap de melhorias, iniciativa I6

## Problema

O vendedor paga o frete de cada venda com frete grátis (`ml_vendas.frete_vendedor`, lido de
`/shipments/{id}/costs`). O ML às vezes troca as dimensões cadastradas por uma estimativa própria e
o frete de um anúncio sobe sem aviso (o ML ignora dimensão no CREATE — ver memória
`reference_ml_dimensoes_create_ignorado`). Hoje ninguém percebe: o valor extra some no meio das vendas.

## Decisões do Diego (2026-09-24)

1. **Liga/desliga por organização** em Configurações > Notificações, só admin altera. Nasce **desligado**.
2. Com o monitor ligado, o aviso vai a **quem assina a categoria `financeiro`** (sem categoria nova).
3. Gatilho **fixo**: frete da venda atual > anterior em **mais de 10% E pelo menos R$ 2**.
4. Abordagem **A**: detecção na chegada da venda, dentro do `sync-venda` (webhook `orders_v2`).

## Regra de detecção

Para a venda que acabou de ser gravada pelo `upsertVenda` no `sync-venda`, avisar se **todas** valerem:

1. `configuracoes.monitor_frete_ativo = true` para a org.
2. O pedido tem **1 linha em `ml_vendas_itens` com `quantity = 1`** e está **fora de pack** (`pack_id` nulo).
   O frete é por pedido; com mais itens/unidades não dá para atribuir o valor a um anúncio, e em pack o
   `frete_vendedor` é o frete do ENVIO repetido em cada pedido (ADR-0042 item 4).
3. `date_closed` (ou `date_created`, se nulo) da venda atual está a **no máximo 3 dias** de agora — update
   tardio de pedido antigo (ex.: mudança de status de envio) não gera aviso.
4. `frete_vendedor` atual **> 0** (null = a busca falhou; 0 = sem custo ao vendedor — nenhum dos dois é
   comparável; lição do incidente de 2026-07-30 "frete saía R$0").
5. Existe **venda anterior** da mesma org com o mesmo `ml_item_id` **e** o mesmo `variation_id`
   (null casa com null), também de 1 linha/1 unidade/fora de pack, não cancelada, `frete_vendedor > 0`.
   Data = `coalesce(date_closed, date_created)`; a referência é a de maior `(data, order_id)` estritamente
   menor que a da venda atual. A seleção é a função SQL `frete_venda_anterior` (execute só `service_role`),
   reusada pela medição — código e medição aplicam a mesma regra.
6. `atual - anterior >= 2` **e** `atual > anterior * 1.10`.
7. `reservarNotificacao(admin, orgId, userId, 'frete_subiu', String(order_id))` devolve `true`
   (dedup em `ml_notificacoes_enviadas`, PK `(org_id, entidade, chave)` — mesmo mecanismo do aviso de venda paga).

Só alta dispara (queda de frete não é problema a alertar).

## Componentes

| Unidade | O que faz | Onde |
|---|---|---|
| `avaliarAltaFrete(atual, anterior)` | Função pura: aplica regras 4, 6 → `{ diferenca, pct } \| null` | `supabase/functions/_shared/faturamento/monitor-frete.ts` |
| `montarMensagemAltaFrete(...)` | Texto do aviso (título, MLB, valores, % e dica de causa) | `supabase/functions/_shared/notificacoes/telegram.ts` |
| `verificarAltaFrete(ctx, deps)` | Orquestra: checagens baratas, lê o toggle, busca a venda anterior, chama a função pura, checa o prazo, reserva e notifica — IO via deps injetadas (`monitor-frete-deps.ts`) | `monitor-frete.ts` |
| chamada no `sync-venda` | No **fim** do handler (depois de alerta de venda, baixa e cancelamento), com prazo de 8 s checado **antes da reserva do dedup** (estourou → desiste sem reservar; sem `Promise.race`, nada roda depois da resposta) e `try/catch` — **o monitor nunca derruba o sync** (a venda é sagrada). O envio ao Telegram não tem timeout próprio — mesmo risco já aceito pelo aviso de venda nova | `supabase/functions/sync-venda/index.ts` |
| função `frete_venda_anterior` + índice `ml_vendas_itens (org_id, ml_item_id)` | seleção da venda de referência (regra 5) | migration nova |
| coluna `monitor_frete_ativo` | `boolean not null default false` + `grant select (monitor_frete_ativo)` a `authenticated` (a tabela tem grant de SELECT por coluna desde `20260822131053`) | migration nova |
| switch na UI | "Monitor de frete" em Configurações > Notificações, gate `podeEditarConfig`; mesmo padrão de `reancora_lider_ativa` (hook em `useConfiguracoes.ts`, query/mutation em `queries.ts`) | `src/components/configuracoes/secao-notificacoes.tsx` |
| tipos | coluna nova em `src/lib/database.types.ts` | — |

O `sync-venda` é o único caller: `backfill-faturamento`, `reconciliar-faturamento` e `sync-devolucao`
também passam por `upsertVenda`, mas **não** chamam o monitor — assim o histórico nunca vira avalanche
de avisos no primeiro run (lição do alerta de cancelamento, ADR-0121).

## Mensagem (Telegram + sino in-app via `notificarCategoria(admin, orgId, 'financeiro', texto)`)

```
🚚 Frete subiu — <título do item> (MLB…)
Esta venda: R$ 24,90 · venda anterior: R$ 15,40 (+62%)
Possível causa: o ML mudou peso/dimensões da embalagem. Confira o anúncio.
```

"Já conferi" = marcar como lida no sino (já existe). O interruptor-mestre `telegram_ativo` continua
valendo só para o canal Telegram, como hoje.

## Erros e bordas

- Falha em qualquer leitura do monitor → `console.error` e segue; sem aviso.
- Webhook reentregue pelo QStash → `reservarNotificacao` impede o segundo aviso.
- Frete regravado depois por backfill/reconciliação → não dispara (só o `sync-venda` chama).
- Webhook que o ML não entregou → venda entra só pela reconciliação, sem aviso. Aceito: a próxima venda
  do mesmo anúncio mostra a mesma alta.
- `ml_vendas` ainda é upsertada por `user_id`; a busca da venda anterior filtra por `org_id` (índice
  `ml_vendas_org_index`), que é a semântica certa para org com mais de um membro.

## Testes

- **TDD da função pura:** exatamente +10% (não dispara), +10% e R$ 1,99 (não), +10,01% e R$ 2 (dispara),
  queda (não), atual 0/null (não), anterior 0/null (não).
- **`verificarAltaFrete` com client mockado:** toggle desligado, pedido de 2 itens, quantity 2, venda com
  mais de 3 dias, sem venda anterior, reserva já tomada → nenhum `notificarCategoria`; caso feliz → 1 chamada
  na categoria `financeiro`.
- **Front:** switch renderiza o estado da coluna e chama a mutation; desabilitado para não-admin.
- **Postgres real (obrigatório — memória `feedback_teste_obrigatorio_feature_nova`):** `db push` + conferir
  o grant (`select monitor_frete_ativo` como `authenticated`); rodar a regra em SQL só-leitura sobre os
  últimos 60 dias da Avil e reportar quantos avisos teriam saído, antes de ligar.

## Fora de escopo

Categoria de notificação própria, limite configurável, tela/lista de histórico de altas, correção
automática de dimensões, pedidos com mais de 1 item e pedidos em pack.
