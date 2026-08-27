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

## Adendo 2026-08-13 — a trava tinha que estar em `upsertVenda`, não no worker

A decisão 2 acima (trava na ingestão) foi implementada no `sync-venda`, e isso **não bastou**:
`upsertVenda` tem quatro chamadores, e o `sync-devolucao` reprocessa o pedido de cada claim pelo
mesmo pipeline para recalcular líquido/estorno (ADR-0093). Como os claims do ML incluem os que a
conta abriu como compradora, ele recriou as 23 compras **27 minutos depois** da migration de
limpeza — descoberto ao investigar o item seguinte da lista, não por alerta.

Correção: a guarda vive dentro de `upsertVenda`, com `contaExternaId` **obrigatório** em `opts` —
o mesmo recurso que o ADR-0109 usa no `custoVigenteResolver` para o compilador cobrar de todo
caller, presente e futuro. A guarda do `sync-venda` continua, agora como otimização (evita buscar
catálogo e Mercado Pago antes de descobrir que é compra), não como a proteção.

Junto, `upsertDevolucao` passou a recusar claim sobre compra (`ehClaimDeCompra`), decidindo pelos
players `buyer`/`seller`. **`sender`/`receiver` não servem**: são papéis logísticos e se invertem na
devolução — o vendedor é quem *recebe* o produto de volta — então usá-los classificaria toda
devolução de venda como compra. Sem `buyer`/`seller` nos players (60% dos claims reais), grava como
antes: só descarta com evidência positiva.

**Lição que vale além deste caso:** ao travar uma regra numa função compartilhada, a pergunta não é
"onde o defeito apareceu" e sim "quantos caminhos chegam aqui". `grep` nos callers antes de
escolher a camada; se são vários, a trava desce para o ponto por onde todos passam — e vira
parâmetro obrigatório, para o compilador guardar a regra no lugar da disciplina.

## Adendo 2026-08-14 — abas Devolvidos e Cancelados no Detalhe do líquido

O filtro `devolvidos` introduzido no adendo de 2026-08-12 (A3/A4/A5) usava `!faturavel` e, depois
da separação parcial, `tem_devolucao`. Os dois critérios inflavam a aba:

1. **Cancelamentos** (`cancelled` sem claim de devolução) apareciam junto das devoluções reais.
2. **`tem_devolucao`** é atalho de badge: `upsertDevolucao` marca a venda em **qualquer** claim
   sincronizado (mediação, `cancel_sale`, etc.), não só `type = 'returns'` — o mesmo critério do
   glossário e de `devolucoesConcluidasNoPeriodo` (ADR-0106).

**Decisão (read-side, sem migration):**

- Aba **Cancelados:** `!faturavel` e nenhum `order_id` com claim `type = 'returns'` em
  `ml_devolucoes` (`orderIdsComDevolucaoReal`).
- Aba **Devolvidos:** o inverso — não faturável **com** claim `returns`.
- `rotuloNaoFaturavel` e `filtrarPedidosFinanceiro` recebem o `Set` de order IDs; callers sem
  devoluções carregadas mantêm fallback em `tem_devolucao` (export/PDF legado).

Contagem validada na conta AVIL (30d, 2026-08-14): 5 devoluções reais vs dezenas antes; o painel
"Devoluções a caminho" do ML (~5) **não** é referência 1:1 — ele lista pela chegada do pacote
(glossário, ADR-0106); esta aba lista pedidos cancelados com claim `returns` no período das vendas.

## Adendo 2026-08-27 — selecionar todos cobre o filtro inteiro

A limitação anterior do checkbox do cabeçalho à página atual foi revertida a pedido do operador.
Com 912 vendas no período, a ação marcava somente as 50 linhas da primeira página, contrariando a
intenção explícita de selecionar todos os registros.

O checkbox agora seleciona todos os pedidos **faturáveis** do filtro e da busca ativos, em todas as
páginas; a paginação limita somente a renderização. Pedidos cancelados ou devolvidos continuam fora
da seleção em massa porque não têm dinheiro a sacar.

Como a seleção global pode alcançar centenas de pedidos, a confirmação acima de 20 itens passa a
proteger as duas ações em massa: **Registrar saque** e **Desfazer saque**. Quantidade e valor da
confirmação consideram apenas os pedidos elegíveis à ação escolhida.

## Fora de escopo

`upsertDevolucao` (`_shared/faturamento/devolucoes-io.ts`) também não valida se a order é uma venda, então um claim sobre compra pode recriar linha em `ml_devolucoes`. Não corrigido aqui: é o menu Faturamento, e a trava óbvia (exigir venda existente) arriscaria descartar devolução legítima cuja venda ainda não sincronizou. Registrado para a próxima rodada.
