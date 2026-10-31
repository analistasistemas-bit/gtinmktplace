/**
 * Texto explicativo por KPI, mostrado no popover do ícone "i" ao lado do card.
 *
 * Chave = o `label` exato do card na maioria dos casos. Só 3 KPIs têm chave composta
 * `"<label>::<tela>"`, porque o mesmo label é calculado por dois pipelines diferentes
 * em telas diferentes (ver docs/superpowers/specs/2026-07-17-kpi-info-tooltip-design.md,
 * seção "Achado colateral"): "Pedidos", "Ticket médio" e "Faturamento".
 */
export const KPI_DESCRIPTIONS: Record<string, string> = {
  // ── Dashboard ──────────────────────────────────────────────────────────
  'Faturamento bruto':
    'Soma do valor total das vendas aprovadas no período (inclui vendas reembolsadas), antes de descontar comissão, frete e imposto.',
  'Líquido das vendas':
    'O que sobra das vendas aprovadas no período depois de descontar a comissão do Mercado Livre e o frete pago pelo vendedor — antes do imposto.',
  'Líquido no faturamento':
    'Valor líquido recebido pelos pedidos aprovados no período, já descontados comissão do Mercado Livre, frete pago pelo vendedor e imposto estimado por origem, contado por pedido (carrinho), não por linha de venda.',
  'Markup no período':
    '(Líquido recebido − imposto − custo) ÷ custo, onde o líquido já vem descontado de comissão do Mercado Livre e frete pago pelo vendedor. Calculado sobre o total do período: soma dos líquidos (já sem imposto) menos soma dos custos, dividido pela soma dos custos. Só entram vendas com custo cadastrado.',
  Compradores:
    'Número de compradores únicos com pelo menos 1 pedido aprovado no período.',
  'A receber':
    'Valor de vendas já aprovadas que ainda não caiu no seu saldo — aguardando a data de liberação do Mercado Pago.',
  'Pedidos::Dashboard':
    'Número de pedidos aprovados no período, contando cada carrinho (pack) como 1 pedido.',
  'Ticket médio::Dashboard':
    'Valor bruto do pedido no checkout (não da linha de venda), somado e dividido pelo número de pedidos.',

  // ── Publicados ─────────────────────────────────────────────────────────
  'Faturamento::Publicados':
    'Soma do valor das vendas aprovadas no período, contada por linha de venda faturável. Pode diferir do "Faturamento" do menu Faturamento em pedidos com um item cancelado e outro pago no mesmo carrinho.',
  'Unidades vendidas':
    'Total de unidades vendidas em vendas aprovadas no período.',
  'Pedidos::Publicados':
    'Número de carrinhos (packs) com pelo menos 1 linha de venda aprovada no período. Pode diferir do "Pedidos" do menu Faturamento em carrinhos com status misto.',
  'Ticket médio::Publicados':
    'Faturamento do período dividido pelo número de pedidos desta tela. Pode diferir do "Ticket médio" do menu Faturamento pelo mesmo motivo do KPI "Pedidos".',
  'Lucro no período':
    'Líquido menos imposto menos custo dos produtos vendidos, somado sobre as vendas do período com custo cadastrado. O líquido já vem descontado de comissão do Mercado Livre e frete pago pelo vendedor.',
  'Saúde dos anúncios':
    'Quantos dos seus anúncios publicados estão ativos, quantos têm algum problema (moderação, estoque zerado etc.) e quantas variações estão publicadas ao todo.',
  'Encalhados (sem venda no período)':
    'Anúncios ativos que não tiveram nenhuma venda no período selecionado. Clique no card para filtrar a lista só por eles.',
  'Top produtos (faturamento)':
    'Os produtos que mais faturaram no período, pelo valor das vendas aprovadas.',

  // ── Financeiro ─────────────────────────────────────────────────────────
  'Líquido das vendas (você recebe)':
    'O que sobra das vendas aprovadas no período depois de descontar a comissão do Mercado Livre e o frete pago pelo vendedor.',
  'Taxas e frete (ML)':
    'Soma da comissão do Mercado Livre e do frete pago pelo vendedor nas vendas do período.',
  Estornos:
    'Valor de vendas do período que foram reembolsadas, total ou parcialmente, ao comprador.',
  'Ticket médio líquido':
    'Valor líquido (já descontadas as taxas do ML) recebido por pedido, em média. Diferente do "Ticket médio" de outras telas, que usa o valor bruto.',
  'Já liberado':
    'Parte do líquido destas vendas que já caiu no seu saldo do Mercado Pago.',
  'A liberar':
    'Parte do líquido destas vendas que ainda está pendente de liberação pelo Mercado Pago.',
  'Vendas no período':
    'Número de pedidos aprovados no período.',
  'Lucro líquido no período':
    'Líquido menos custo menos imposto, somado sobre as vendas do período com custo cadastrado. O líquido já vem descontado de comissão do Mercado Livre e frete pago pelo vendedor.',

  // ── Faturamento / aba Vendas ──────────────────────────────────────────
  'Faturamento::Faturamento/Vendas':
    'Soma do valor bruto dos pedidos aprovados no período, contando o pedido inteiro pelo status de uma venda representante do carrinho. Pode diferir do "Faturamento" de Publicados em carrinhos com status misto.',
  Líquido:
    'Valor líquido recebido dos pedidos aprovados no período, já descontados comissão, frete e imposto estimado por origem.',
  'Pedidos::Faturamento/Vendas':
    'Número de pedidos aprovados no período, contando cada carrinho (pack) como 1 — o pedido inteiro conta pelo status de uma venda representante do carrinho.',
  Unidades:
    'Total de unidades vendidas nos pedidos do período.',
  'Ticket médio::Faturamento/Vendas':
    'Valor bruto do pedido no checkout, somado e dividido pelo número de pedidos aprovados.',
  'Itens / pedido':
    'Média de itens (linhas de produto) por pedido no período.',
  Markup:
    '(Líquido recebido − imposto − custo) ÷ custo, onde o líquido já vem descontado de comissão do Mercado Livre e frete pago pelo vendedor. Calculado sobre o total do período: soma dos líquidos (já sem imposto) menos soma dos custos, dividido pela soma dos custos. Só entram pedidos com custo cadastrado.',

  // ── Faturamento / aba Geografia ───────────────────────────────────────
  'Estados atingidos':
    'Número de estados (UF) diferentes com pelo menos 1 pedido no período.',
  'Top estado':
    'Estado com mais pedidos no período, e o quanto ele representa do total.',
  Cidades:
    'Número de cidades diferentes com pelo menos 1 pedido no período.',
  Concentração:
    'Menor número de estados que, somados, chegam a 80% do valor faturado no período. Quanto menor, mais o faturamento depende de poucos estados.',
  'Sem localização':
    'Pedidos do período sem UF identificada — o endereço de entrega não veio disponível pela API do Mercado Livre.',

  // ── Páginas de detalhe (drill-down) ───────────────────────────────────
  'Líquido total (você recebe)':
    'Soma do líquido de todas as vendas listadas nesta tela — mesmo valor do card "Líquido das vendas" de Financeiro, com o detalhamento por venda logo abaixo.',
  'Faturamento total':
    'Soma do valor bruto de todas as vendas listadas nesta tela, dividido entre anúncios publicados pelo PubliAI e vendas fora do PubliAI.',

  // ── Estoque ────────────────────────────────────────────────────────────
  'SKUs cadastrados':
    'Número de variações (SKUs) cadastradas na sua organização, somando todos os produtos. Não muda com a busca nem com o filtro da tela.',
  'Unidades em estoque':
    'Soma do saldo de todos os SKUs com estoque positivo. SKUs zerados não somam, e saldo negativo (inconsistência de ledger) é ignorado em vez de subtrair.',
  'SKUs sem estoque':
    'Quantos SKUs estão com saldo zero ou negativo — são os que precisam de entrada de mercadoria. Anúncio com saldo zero é pausado pelo próprio Mercado Livre e volta sozinho quando entra estoque.',
  'Valor em estoque':
    'Soma de custo × saldo de cada SKU com estoque, usando o último custo informado na entrada. SKUs com estoque e sem custo cadastrado ficam de fora do total e são avisados abaixo do valor.',

  // ── Carteira (Central) ────────────────────────────────────────────────
  'Faturamento bruto da carteira':
    'Soma do faturamento bruto de todas as organizações no mês selecionado (vendas pagas e reembolsadas, antes de taxas; canceladas fora). Mês-calendário em America/Fortaleza.',
  'Previsão de cobrança':
    'Total previsto dos demonstrativos do mês, somando só organizações com condição comercial vigente e sem bloqueio. Organizações sem contrato ficam fora do total.',
  'Pendências da carteira':
    'Bloqueios que impedem fechar o demonstrativo: condição comercial ausente, devolução sem conciliação ou venda alterada após fechamento.',
  'Organizações da carteira':
    'Organizações ativas na plataforma. Ambientes de teste ficam ocultos por padrão e fora dos totais.',

  // Pulse (ADR-0119)
  'No radar':
    'Quantas fichas de catálogo o Pulse acompanha hoje: as dos seus anúncios publicados (entram sozinhas) mais as que você adicionou à mão. Produto pausado no radar não conta.',
  'Mais caro que o mercado':
    'Em quantas fichas o seu preço publicado está acima do menor concorrente. Só conta fichas onde há preço seu e pelo menos uma oferta concorrente coletada — o total comparável aparece abaixo do número.',
  'Você é o menor preço':
    'Em quantas fichas o seu preço publicado é o mais barato entre os concorrentes coletados. Sua própria oferta nunca entra na comparação.',
  'Sem vínculo de catálogo':
    'Fichas em que o seu anúncio não está vinculado ao catálogo do Mercado Livre. Sem vínculo ele não disputa a página e o ML não calcula preço para ganhar — resolver a ficha divergente devolve as duas coisas.',

  // ── Pulse / Sonar (ADR-0122, ADR-0142, ADR-0146) ───────────────────────
  'Vendas acumuladas':
    'Soma do "+N vendidos" que o Mercado Livre exibe nos anúncios da amostra. É acumulado da VIDA de cada anúncio, não venda do mês, e o número do ML é uma faixa-piso ("+100" pode ser 199) — por isso a soma é um piso do nicho, nunca uma estimativa de ritmo.',
  'Mercado endereçável':
    'Σ (preço atual × vendidos acumulados) dos anúncios da amostra. É faturamento acumulado na vida dos anúncios, não a receita de um ano: multiplica o preço de hoje por vendas feitas ao longo de meses, e com desconto ativo usa o preço promocional. Serve para comparar nichos entre si, não para projetar receita.',
  'Concorrentes vendendo mais que há um ano':
    'Quantos vendedores da amostra têm hoje mais transações na conta do que no mesmo ponto de 12 meses atrás. É a LOJA INTEIRA do vendedor (ADR-0142): a API do Mercado Livre não expõe venda por anúncio de terceiro. Sinal de nicho em expansão ou retração, nunca de venda deste produto.',
  'Média mensal por vendedor (12 meses)':
    'Total de transações da conta do vendedor dividido por 12 (ADR-0146). O campo do ML é uma janela móvel de 365 dias, provada no Spike 048 — por isso ÷12 é média mensal de verdade. Continua sendo da loja inteira, somando nichos sem relação com o que você está prospectando.',

  // ── Faturamento / aba Vendas SKU (ADR-0172): lucro por ITEM, não por pedido ──
  'Lucro::vendas-sku':
    'Soma, por item vendido, do líquido (já sem comissão, frete e imposto) menos o custo. Só entram itens com custo; item sem custo não entra como lucro.',
  'Markup::vendas-sku':
    'Lucro ÷ custo, somando item a item. Mede o retorno sobre a compra. Só itens com custo.',
  'Margem s/ venda::vendas-sku':
    'Lucro ÷ preço de venda dos itens com custo. Mede a saúde do preço.',
  'Faturamento com custo real::vendas-sku':
    'Quanto do faturamento tem custo congelado na venda. O resto usa o custo atual do cadastro (custo estimado) ou não tem custo.',

  // ── Ads: filtros do ranking de famílias (ADR-0179) ──
  'Todas::Ads':
    'Famílias presentes no painel neste período, mantendo a ordem por gasto.',
  'Acima do equilíbrio::Ads':
    'Famílias cujo ACOS direto passou do equilíbrio observado no período. O filtro usa o semáforo existente e não recomenda alteração de orçamento.',
  'Dentro do equilíbrio::Ads':
    'Famílias cujo ACOS direto está dentro da referência pela margem observada no período.',
  'Sem referência::Ads':
    'Famílias sem semáforo disponível. Inclui todas as famílias enquanto o semáforo estiver em validação.',
  'ACOS direto::Ads':
    'ACOS direto: investimento dividido pela receita atribuída diretamente aos produtos desta família. '
    + 'Ex.: 9,2% = de cada R$ 100 vendidos pelo anúncio, o Ads custou R$ 9,20. "sem venda direta": gastou sem vender pelo próprio anúncio.',
  'Equilíbrio observado::Ads':
    'Equilíbrio observado: margem antes de Ads nas vendas desta família durante o período. '
    + 'O mix das vendas atribuídas pode ser diferente. ACOS direto acima disso: a venda pelo anúncio dá prejuízo. Não é o equilíbrio no preço atual.',
  'Família::Ads':
    'Produto agrupado pelo código PAI. Soma os grupos de Ads de todos os anúncios da família; grupo que mistura '
    + 'famílias vai para Gastos associados, sem rateio.',
  'Investimento::Ads':
    'Gasto em Product Ads informado pelo Mercado Livre no escopo exibido: conta inteira, campanha ou família. '
    + 'Na família, soma só os grupos de anúncios exclusivos dela; gasto compartilhado entre famílias não é rateado.',
  'Resultado após Ads::Ads':
    'Lucro antes de Ads (vendas da família no período, já sem comissão, frete, imposto e custo) menos o Gasto. '
    + 'Só entram itens com custo; com custo parcial, o resultado também é parcial. Não é o lucro causado pelo Ads. Fica "—" quando o período começa antes do histórico de vendas, a coleta de '
    + 'Ads não cobre o período ou há gasto compartilhado com outras famílias.',
  // ── Ads: faixa de KPIs, campanhas, competitividade e resumo da conta (Task 36) ──
  'Vendas por Ads::Ads':
    'Quantidade de vendas atribuídas ao Ads, como informada pelo Mercado Livre. É contagem de vendas, não receita nem unidades: '
    + 'uma venda de 3 peças conta 1 aqui. A receita aparece em Receita Ads e as peças em Unidades vendidas.',
  'Vendas Ads::Ads':
    'Quantidade de vendas atribuídas ao Ads na campanha, como informada pelo ML. Não é receita nem unidades.',
  'Receita Ads::Ads':
    'Valor vendido (R$) que o ML atribui ao Ads no período, somando vendas diretas e indiretas. Não é lucro nem faturamento da conta.',
  'ROAS::Ads':
    'Receita atribuída ao Ads ÷ investimento, calculados sobre o total do período (não é média dos dias). '
    + 'Ex.: 8,0x = cada R$ 1 investido trouxe R$ 8 em vendas atribuídas. Sem investimento, fica indisponível.',
  'ACOS::Ads':
    'Investimento ÷ receita atribuída ao Ads no período. Ex.: 12% = de cada R$ 100 atribuídos ao Ads, R$ 12 foram gastos. '
    + 'Sem receita atribuída, fica indisponível. É o inverso do ROAS.',
  'TACOS da conta::Ads':
    'Investimento em Ads ÷ faturamento total do Mercado Livre da organização no período. O faturamento inclui todas as vendas '
    + 'faturáveis da conta (também as de anúncios sem Ads e fora do cadastro), já com o cupom do vendedor descontado. '
    + 'Sem faturamento ou com histórico incompleto, fica indisponível.',
  'Impressões::Ads':
    'Quantas vezes seus anúncios patrocinados foram exibidos no período, informado pelo ML.',
  'Cliques::Ads':
    'Quantos cliques os anúncios patrocinados receberam no período, informado pelo ML.',
  'CTR::Ads':
    'Cliques ÷ impressões no total do período. Mostra quanto da exibição vira clique. Sem impressões, fica indisponível.',
  'CPC::Ads':
    'Investimento ÷ cliques no total do período: quanto cada clique custou em média. Sem cliques, fica indisponível.',
  'Conversão::Ads':
    'Conversão informada pelo ML para o período (CVR). O app não recalcula esse número: se o ML não o retornar, aparece como indisponível.',
  'Ganhas::Ads':
    'Participação nas impressões ganhas: parcela das exibições possíveis que a campanha efetivamente conquistou, segundo o ML.',
  'Perdidas por orçamento::Ads':
    'Parcela das impressões perdidas porque o orçamento da campanha acabou. Aumentar o orçamento pode recuperar parte delas.',
  'Perdidas por classificação::Ads':
    'Parcela das impressões perdidas porque o anúncio ficou mal classificado no leilão (lance, qualidade, relevância).',
  'Lucro antes de Ads::Ads':
    'Lucro das vendas da conta no período, já sem comissão, frete, imposto e custo, antes de descontar a despesa de Ads. '
    + 'Parcial: vendas sem custo ficam de fora. Estimado: o custo existe, mas é o atual do cadastro, não o custo real congelado na venda.',
  'Despesa de Ads::Ads':
    'Investimento em Ads da conta inteira no período, informado pelo ML, incluindo gasto compartilhado ou não identificado, sem rateio.',
  'Resultado parcial após Ads::Ads':
    'Lucro antes de Ads menos a despesa de Ads, com parte das vendas sem custo (por isso parcial). Custo apenas estimado é marcado como Estimado, à parte. Não é o lucro completo nem o causado pelo Ads.',
  'Outras vendas::Ads':
    'Vendas do universo dos anúncios promovidos que o ML não atribui ao Ads. Não são as vendas orgânicas da conta inteira.',
};

/** Resolve a descrição de um KPI pelo `label` (ou `infoKey` composto). undefined = sem entrada
 *  no dicionário — o chamador (`KpiInfoButton`) trata isso como "não mostrar ícone". */
export function getKpiDescription(key: string): string | undefined {
  return KPI_DESCRIPTIONS[key];
}
