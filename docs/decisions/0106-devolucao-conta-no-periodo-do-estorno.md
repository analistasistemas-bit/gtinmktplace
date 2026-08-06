# ADR-0106 — Devolução conta no período em que o dinheiro saiu

- **Status:** aceito
- **Data:** 2026-08-06
- **Contexto relacionado:** ADR-0037 (claims/post-purchase), ADR-0038 (estorno via MP),
  glossário "Devolução (concluída)"

## Contexto

O card **Faturamento bruto** do Dashboard mostra um discreto "N devoluções · R$ X" do período
selecionado. Em 2026-08-06, com o filtro **Mês atual**, ele mostrava `1 devolução · R$ 56,16`
enquanto o painel nativo do ML mostrava outra coisa — Diego reportou como erro.

Dois problemas distintos foram encontrados, ambos confirmados contra o banco de produção
(8 claims reais da conta AVIL, lidos em 2026-08-06):

1. **Período pela data errada.** O filtro usava `aberto_em` (`claim.date_created`), a data em que
   o comprador abriu a reclamação. O claim 5552400113 abriu em 31/07 e só foi reembolsado
   (R$ 70,50) em 03/08: contava em julho, e agosto — o mês que perdeu o dinheiro — não via nada.

2. **Devolução fechada contada como aberta.** O card "Precisa de atenção" contava
   `acoes_pendentes.length > 0` sem olhar o `status`. O ML continua devolvendo `available_actions`
   ("return review ok", com prazo) em claim já fechado e reembolsado — o claim 5550524900 estava
   finalizado no ML e ainda aparecia como "1 devolução aberta".

## Decisão

**A devolução pertence ao período em que o estorno saiu, não ao da abertura do claim.**

A data é `claim.resolution.date_created`, gravada na nova coluna `ml_devolucoes.fechado_em`
(migration `20260806151323`, com backfill a partir do `raw` já guardado).

Essa data é o mesmo instante do estorno no Mercado Pago — conferido em 5 devoluções reais contra
`ml_vendas.raw->payments[].date_last_modified`:

| claim | resolution.date_created | payment.date_last_modified |
|---|---|---|
| 5553795965 | 2026-08-03T17:16:36-04 | 2026-08-03T17:16:41-04 |
| 5550524900 | 2026-07-30T10:10:00-04 | 2026-07-30T10:10:08-04 |
| 5544792393 | 2026-07-22T12:56:00-04 | 2026-07-22T12:57:57-04 |
| 5552400113 | 2026-08-03T15:27:00-04 | 2026-08-03T15:27:27-04 |
| 5531142374 | 2026-06-22T14:30:00-04 | 2026-06-22T14:30:24-04 |

O **critério** de "concluída" não muda: `type = 'returns'` **e** `return_status_money = 'refunded'`
(glossário, conferido 1:1 com a API do ML em 2026-07-31). Só a data de atribuição muda.

**"Aberta" passa a exigir `status = 'opened'`** além de ter ação pendente — o mesmo critério da
pill Aberta/Fechada da aba Devoluções.

Ambas as regras viraram funções puras em `src/lib/devolucoes.ts`
(`devolucoesConcluidasNoPeriodo`, `devolucoesAbertas`), testadas com os 8 claims reais como
fixture.

## Consequências

- O card deixa de bater com a data que o painel "Devoluções" do ML exibe — **de propósito**.
  Aquela tela lista pela **chegada do pacote de volta** (evento posterior ao estorno, e às vezes
  muito posterior: no claim 5531142374 o dinheiro saiu em 22/06 e o pacote chegou em 15/07) e,
  como o glossário já registra, não lista de forma confiável claim resolvido por mediador. Para
  um número que fica embaixo do faturamento bruto, o que importa é quando o dinheiro saiu.
- Mês atual (01–06/08) passa de `1 devolução · R$ 56,16` para `2 devoluções · R$ 126,66` —
  entram os claims 5552400113 (R$ 70,50) e 5553795965 (R$ 56,16), ambos reembolsados em 03/08.
- Devolução em curso não some do card: se o dinheiro já saiu (`refunded`), ela conta, mesmo com o
  produto ainda voltando (`return_status = 'shipped'`).
- `fechado_em` só é preenchido no sync a partir daqui; o backfill cobre o histórico via `raw`.
  Linha sem a data (claim aberto, ou `raw` sem `resolution`) cai no `aberto_em` como antes.

## Alternativa descartada

Espelhar a data de chegada do pacote que o ML exibe. Exigiria guardar o payload de
`/post-purchase/v2/claims/{id}/returns` (que hoje nem sempre volta — 2 dos 8 claims estão com
`return_status` nulo por falha de parse dessa chamada) e atribuiria o estorno a um mês diferente
do mês em que o caixa foi afetado.
