# ADR-0117 — Menu Financeiro controla liberação e saque; compra não é venda

**Status:** Aceito — implementado na branch `worktree-review-financeiro`
**Data:** 2026-08-12
**Relacionados:** ADR-0038 (fonte única `ml_vendas`), ADR-0031 (financeiro MP), ADR-0060 (ações restritas a admin), ADR-0082 (poll incremental), ADR-0055 (imposto por origem)

## Problema

A revisão completa do menu (`.code-review-fable5/code-review-v11.md`, score 42/100, veredito BLOQUEAR) mostrou que o menu foi construído sobre uma premissa falsa: **toda linha de `ml_vendas` é uma venda faturável**. Ela falha por dois caminhos independentes, ambos medidos na base de produção em 2026-08-12:

1. **Compras da própria empresa entram na tabela.** O webhook `orders_v2` do ML notifica pedidos em que a conta é comprador *ou* vendedor, e `sync-venda` gravava todos. 23 linhas (R$ 37.118,27), das quais 7 em `paid` contavam como faturamento (R$ 8.810,50) e líquido (R$ 7.597,48). O sintoma que expôs o defeito: uma memória RAM comprada pela AVILBV, devolvida pelo fornecedor, aparecendo no Detalhe do líquido.
2. **Devolução concluída vira `cancelled`.** O agregador de KPIs filtrava isso; a tabela do Detalhe, a régua de liberação e a RPC de saque não. Resultado: 46 pedidos devolvidos marcados como sacados (R$ 2.849,54).

Além disso, dois KPIs informavam número errado sobre dinheiro (o card "Estornos" mostrava R$ 12,55 de R$ 3.394,20 reais em 30 dias; "Já liberado" misturava sacado com não sacado), e a tela listava 985 pedidos sem busca nem paginação.

## Decisão

**1. O menu Financeiro responde uma pergunta: quanto o ML liberou, quanto falta liberar, o que já foi sacado.**
Markup, lucro líquido, ticket médio e nº de vendas saem da tela — respondem "quanto lucrei" e já existem no Faturamento e no Dashboard, derivados do mesmo agregador. Três telas com o mesmo número já divergiram duas vezes neste projeto (ver `reference_markup_padrao_e_testes_mortos`).

**2. Compra não é venda, e a trava vive na ingestão.**
`sync-venda` recusa pedido cujo `seller.id` não seja a conta conectada (`ehVendaDaConta`, função pura testada), respondendo 200 com `{ignorado: 'compra-da-conta'}` — 4xx/5xx faria o QStash re-tentar para sempre. As 23 linhas históricas foram apagadas, junto das 25 devoluções abertas sobre elas. É o equivalente ao filtro `collector_id` que o ADR-0031 já aplica no caminho do Mercado Pago.

**3. Só venda faturável tem dinheiro a sacar, verificado em três camadas.**
Ingestão (não grava compra), banco (`registrar_saque_ml_vendas` exige `status in ('paid','partially_refunded','refunded')`) e interface (a lista esconde não faturável por padrão; a checkbox da linha devolvida é desabilitada). Camada única não basta: a regra é sobre dinheiro e cada porta que a ignora reabre o defeito.

**4. Registrar e desfazer saque passam a exigir admin.**
Mesmo predicado `is_admin()` que o ADR-0060 aplica a pausar/reativar anúncio — movimentação financeira é ao menos tão sensível.

**5. `estornos` conta todo pedido do período, faturável ou não.**
Estorno é dinheiro que saiu, e a maior fonte dele são justamente as devoluções (`cancelled`). Os demais KPIs seguem restritos a faturáveis (ADR-0038 inalterado).

**6. Novo KPI `aSacar`** — líquido liberado com `sacado_em is null`. `liberado` continua existindo como histórico do período, mas o card principal passa a ser o acionável.

## Consequências

- O faturamento de qualquer período que contivesse uma compra muda (para menos, e para o valor correto). O Dashboard e o Faturamento também, por lerem a mesma tabela.
- O card "Estornos" passa a mostrar um número muito maior — é o valor real, não uma regressão.
- Operador não-admin perde a ação de saque. Se algum precisar, é reverter o predicado numa migration e registrar o motivo aqui.
- A tabela do Detalhe pagina de 50 em 50. Os totais do rodapé continuam somando o **filtro inteiro**, nunca a página — invariante coberta por teste.
- `Pedido` ganhou `faturavel` e `brutoFaturavel` (commit `e96b35d2`, revisão anterior); `ResumoVendas` ganhou `aSacar`.

## Alternativas descartadas

- **Marcar compras com uma flag em vez de apagar.** Preservaria o registro, mas obrigaria todo consumidor presente e futuro a lembrar do filtro — o mesmo tipo de armadilha que causou o defeito original. Compra não pertence a `ml_vendas`.
- **Filtrar compras só na leitura.** Deixaria o dado sujo no banco e não protegeria nenhum consumidor novo.
- **Manter cancelados na lista, apenas bloqueando o saque.** Foi o estado intermediário (commit `82acc061`). Insuficiente: a tela de recebimento continuaria listando o que não tem dinheiro a receber, e a proteção dependeria de o operador não clicar.

## Adendo 2026-08-12 — os 3 médios

Fechados na mesma data, a pedido do Diego:

- **`statusLiberacao` ganhou o estado `sem_direito`.** A régua decidia só por data, e a devolução
  mantém a `money_release_date` gravada quando a venda ainda valia — então a aba `Devolvidos`
  anunciava "10/08/2026 liberado" para dinheiro que voltou ao comprador. `faturavel: false` agora
  vence a régua; tela e PDF omitem a data. O campo é opcional na entrada (quem não tem a
  informação preserva o comportamento anterior), mas todos os consumidores do Financeiro passam.
- **Confirmação no saque em massa** acima de 20 pedidos (`resumoSelecaoSaque`, função pura), com
  quantidade e soma em R$ na mesma base da coluna "Líquido" — e deixando claro que a marca é
  conciliação local, não movimentação no ML.
- **Aviso de volume na exportação:** `BotaoExportar` recebe `totalLinhas` opcional e, acima de 200,
  avisa antes de gerar (abrindo o diálogo mesmo quando não há outra opção a perguntar). Não corta
  dado — exportar meia lista seria pior que o problema.

O quarto médio (KPIs de lucratividade duplicando o Faturamento) já havia sido resolvido pela
decisão 1 deste ADR.

## Fora de escopo

`upsertDevolucao` (`_shared/faturamento/devolucoes-io.ts`) também não valida se a order é uma venda, então um claim sobre compra pode recriar linha em `ml_devolucoes`. Não corrigido aqui: é o menu Faturamento, e a trava óbvia (exigir venda existente) arriscaria descartar devolução legítima cuja venda ainda não sincronizou. Registrado para a próxima rodada.
