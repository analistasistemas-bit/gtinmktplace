# ADR-0172 — Vendas SKU: análise de vendas por variação, com história e coleta diária

**Status:** Proposto
**Data:** 2026-09-26
**Relacionado:** [ADR-0039](0039-faturamento-por-pedido-geografia-kpis.md) (revoga o "ranking de produto /
curva ABC fora de escopo"), [ADR-0047](0047-operacao-compartilhada-rbac-menu.md) (permissão por menu),
[ADR-0055](0055-imposto-por-origem-nacional-importado.md) (imposto), [ADR-0081](0081-corte-de-egress-url-assinada-persistida.md) (egress),
[ADR-0106](0106-devolucao-conta-no-periodo-do-estorno.md) (devolução no período do estorno),
[ADR-0109](0109-custo-congelado-por-venda.md) (custo congelado), [ADR-0119](0119-pulse-inteligencia-de-mercado-dirigida.md) /
[ADR-0140](0140-sonar-ean-analise-completa-pela-busca.md) (busca do ML fechada; Apify),
[ADR-0150](0150-margem-um-rotulo-e-um-simulador-no-pulse.md) (Margem s/ venda × Markup)
**Spec:** [2026-09-26-vendas-sku-design](../superpowers/specs/2026-09-26-vendas-sku-design.md)

## Contexto

O Faturamento responde "quanto vendi" por pedido. Não responde "quais produtos sustentam o resultado" nem
"o que aconteceu com este produto desde que começou a vender". O benchmark (Mercado Turbo, *Vendas por SKU*,
visitado em 2026-09-26) entrega só um ranking de faturamento bruto do período: sem eixo de tempo, sem
custo/lucro, sem comparação de períodos, com canceladas somadas ao total. O PubliAI já tem os dados que
faltam lá: custo congelado em 99,7% dos itens desde jun/2026, imposto por origem, devoluções, estoque e
promoções.

Medido em 2026-09-26: a Avil tem vendas no PubliAI a partir de **jun/2026** (101 · 740 · 1.134 · 1.288
pedidos/mês); `ml_vendas_itens.codigo` está preenchido em 99,9% dos itens.

O ADR-0039 deixou "ranking de produto, curva ABC" fora do Faturamento. Este ADR revoga esse trecho.

## Decisão

### D-1 — A unidade é a variação (`codigo`), com agrupamento por família
A análise segue o código, que atravessa republicação (MLB novo), canal e custo. Nunca o MLB. A lista pode
ser **agrupada por família**, que soma as variações e continua mostrando cada uma.

Chave = `ml_vendas_itens.codigo`. Título, foto, família e estoque vêm da **família mais recente** do
`(org_id, codigo)`, a mesma âncora do estoque canônico e do Publicados (ADR-0025). Cada reimportação cria
família nova com o mesmo código, então um join simples multiplicaria linhas. Medido em 2026-09-26: 99,9% dos
itens vendidos têm o código de uma variação real e nenhum tem o código pai. Item sem código cai numa linha
"sem código" e nunca é descartado. Kit vinculado aparece sob o próprio código. Kit Virtual aparece nos
componentes (o ML gera um pedido por componente).

### D-2 — A história começa na entrada da organização no PubliAI
Sem backfill de pedidos anteriores. A tela diz a partir de quando conta ("histórico desde jun/2026").

### D-3 — Lucro é o protagonista; dois percentuais com o denominador no nome
Ranking e Curva ABC ordenam por **lucro** (líquido − custo congelado) por padrão, com troca para
faturamento ou unidades. Ao lado aparecem **Markup** (`lucro ÷ custo`) e **Margem s/ venda**
(`lucro ÷ preço de venda`), com os nomes do ADR-0150.

O lucro é calculado **por item**, não por pedido. Assim, um pack com custo em só parte dos itens não infla o
lucro. A regra de custo é a da aba Vendas, mas visível. Com custo congelado, vale ele. Sem congelado, vale o
custo atual do cadastro, marcado **"custo estimado"**. Sem nenhum custo, o lucro fica vazio e o SKU sai do
ranking por lucro. SKU com parte das vendas sem custo mostra **"lucro parcial"**. Um KPI mostra o **% do
faturamento com custo real**.

**Todo produto tem que ter custo** (Diego, 2026-09-26). SKU sem custo é alerta de primeira classe, e não só
uma nota:
- uma faixa no topo da aba ("N SKUs sem custo · R$ X de faturamento sem lucro calculado");
- um filtro "sem custo";
- um selo na linha.

### D-4 — Mesma regra da aba Vendas para o dinheiro; taxa de devolução por coorte
O dinheiro segue `ehFaturavel` e o ADR-0106 (estorno no período em que aconteceu). A soma de todos os SKUs
de um período é igual ao total da aba Vendas no mesmo filtro, por construção (D-5).

A **taxa de devolução** olha as vendas do período: dos pedidos do SKU vendidos no período, quantos foram
devolvidos, qualquer que seja a data do estorno. É contada em pedidos, porque a devolução parcial não informa
a quantidade. A devolução chega ao SKU pelo pedido, porque no ML 1 pedido = 1 item (medido em 2026-09-26:
4.211 de 4.211). Medido também: 161 de 175 devoluções casam com um pedido. Devoluções de carrinho e de envio
sem pedido vão para "devolução não atribuída". Hoje `pedidos-faturamento.ts` joga o estorno inteiro no 1º
item do pedido, o que é indiferente com 1 item por pedido.

### D-5 — Cálculo no navegador, sobre os itens da aba Vendas
O ranking agrupa por SKU os **itens que `agruparPorPedido` já produz** (`src/lib/pedidos-faturamento.ts`), a
mesma fonte da aba Vendas, do Financeiro, do Dashboard e da Geografia. Não existe fórmula nova de lucro, nem
em SQL nem em TS. A soma bate com a aba Vendas por construção. A paginação (teto de 1.000 linhas) e o cache já
existem em `useVendas`. O período carregado estica para trás o necessário para a tendência (60 dias). O
dossiê (Fatia 2a) busca um SKU só. Migrar para agregação no banco só se uma org passar de ~10 mil pedidos no
período. Revisão Codex (GPT-6 Astra) de 2026-09-26: uma RPC seria a 3ª implementação de comissão, frete,
imposto por UF e custo. Permissão herdada do menu Faturamento (ADR-0047). A aba vive em
`/faturamento?aba=sku` e o dossiê em `/faturamento/sku/:codigo` (família:
`/faturamento/sku/familia/:codigo_pai`).

### D-6 — Coleta diária nova, só leitura no ML
Três séries diárias por anúncio próprio, gravadas pelo PubliAI:
- **Visitas** (API oficial `items/{id}/visits/time_window`), com carga inicial de até 150 dias. Com as vendas,
  dá a **conversão**.
- **Preço diário** (foto do preço do próprio anúncio). Só daqui para frente; o passado vem do preço
  praticado nas vendas.
- **Ads** (Product Ads), **condicionado a um spike**: permissão do app e uso real pelas orgs.

**Posição na busca** fica condicionada a um spike de custo. A busca oficial está fechada para nós
(ADR-0119), o caminho é Apify pago por consulta e exige uma palavra-chave por SKU. Nada é ligado antes de o
custo mensal medido ser aprovado pelo Diego.

Nenhuma coleta escreve no ML.

### D-7 — Limites de tendência e risco fixos na v1
Tendência (30 dias contra os 30 anteriores: ±20%, mínimo de 5 unidades), cobertura < 15 dias e devolução
> 5% (com ≥ 20 pedidos) são constantes no código, sem tela de configuração. Recalibrar com dado real.

## Consequências

- Um percentual novo ("Margem s/ venda") passa a existir fora do Pulse. É o mesmo nome e a mesma conta do
  ADR-0150, não um quinto cálculo de margem.
- A história da Avil começa com ~4 meses. Cresce sozinha.
- Promoção é evento **aproximado** na linha do tempo: guardamos o estado atual do item na campanha, não quando
  entrou ou saiu.
- As séries diárias criam tabelas e crons novos (migration + worker QStash com `verify_jwt=false`),
  entregues na Fatia 2b.
- Entrega: Fatia 1 (aba) → 2a (dossiê com dados existentes) → 2b (visitas, conversão, preço diário) → 2c
  (Ads e posição, após spikes) → 3 (recompra, exportação, ações).

## Alternativas descartadas

- **Unidade = família ou MLB:** o MLB muda na republicação e quebra a história; a família esconde qual cor
  puxa a venda.
- **Backfill de pedidos antigos:** Diego preferiu começar na entrada no PubliAI.
- **Ranking por faturamento (como o benchmark):** coloca no topo SKU que fatura e dá prejuízo.
- **Agregar no banco (RPC):** reescreveria em SQL comissão, frete rateado, imposto por UF e custo, uma 3ª
  fórmula que exigiria teste de paridade permanente com a aba Vendas.
