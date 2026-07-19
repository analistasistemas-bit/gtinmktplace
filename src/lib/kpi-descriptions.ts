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
    '(Líquido recebido − imposto − custo) ÷ custo, somado sobre as vendas do período que têm custo cadastrado. Vendas sem custo não entram na conta.',
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
    'Líquido menos custo dos produtos vendidos, somado sobre as vendas do período com custo cadastrado.',
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
    'Líquido menos custo menos imposto, somado sobre as vendas do período com custo cadastrado.',

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
    '(Líquido recebido − imposto − custo) ÷ custo de cada pedido, somado sobre os pedidos do período com custo cadastrado.',

  // ── Faturamento / aba Geografia ───────────────────────────────────────
  'Estados atingidos':
    'Número de estados (UF) diferentes com pelo menos 1 pedido no período.',
  'Top estado':
    'Estado com mais pedidos no período, e o quanto ele representa do total.',
  Cidades:
    'Número de cidades diferentes com pelo menos 1 pedido no período.',
  'Sem localização':
    'Pedidos do período sem UF identificada — o endereço de entrega não veio disponível pela API do Mercado Livre.',

  // ── Páginas de detalhe (drill-down) ───────────────────────────────────
  'Líquido total (você recebe)':
    'Soma do líquido de todas as vendas listadas nesta tela — mesmo valor do card "Líquido das vendas" de Financeiro, com o detalhamento por venda logo abaixo.',
  'Faturamento total':
    'Soma do valor bruto de todas as vendas listadas nesta tela, dividido entre anúncios publicados pelo PubliAI e vendas fora do PubliAI.',
};

/** Resolve a descrição de um KPI pelo `label` (ou `infoKey` composto). undefined = sem entrada
 *  no dicionário — o chamador (`KpiInfoButton`) trata isso como "não mostrar ícone". */
export function getKpiDescription(key: string): string | undefined {
  return KPI_DESCRIPTIONS[key];
}
