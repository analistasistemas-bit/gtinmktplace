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

### D-2 — A história começa na entrada da organização no PubliAI
Sem backfill de pedidos anteriores. A tela diz a partir de quando conta ("histórico desde jun/2026").

### D-3 — Lucro é o protagonista; dois percentuais com o denominador no nome
Ranking e Curva ABC ordenam por **lucro** (líquido − custo congelado) por padrão, com troca para
faturamento ou unidades. Ao lado aparecem **Markup** (`lucro ÷ custo`) e **Margem s/ venda**
(`lucro ÷ preço de venda`), com os nomes do ADR-0150. Venda sem custo aparece como "sem custo" e fica fora do
ranking por lucro.

### D-4 — Mesma regra da aba Vendas, e a soma bate
Canceladas e devolvidas seguem `ehFaturavel` e o ADR-0106, em colunas próprias (quantidade, R$, taxa de
devolução). A soma de todos os SKUs de um período é igual ao total da aba Vendas no mesmo filtro. Um teste
automatizado garante isso.

### D-5 — Agregação no banco, por RPC
O ranking e a série temporal são agregados no Postgres (RPC por org, período e granularidade), não no
navegador. Motivos: volume (~1.300 pedidos/mês numa org), o teto de 1.000 linhas do PostgREST e o corte de
egress do ADR-0081. A RPC é a fonte única que o teste de D-4 confere. RLS por `org_id`; permissão herdada do
menu Faturamento (ADR-0047). A aba vive em `/faturamento?aba=sku` e o dossiê em `/faturamento/sku/:codigo`
(família: `/faturamento/sku/familia/:codigo_pai`).

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
> 5% (com ≥ 20 unidades) são constantes no código, sem tela de configuração. Recalibrar com dado real.

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
- **Agregar no navegador:** esbarra no teto de 1.000 linhas e no egress.
