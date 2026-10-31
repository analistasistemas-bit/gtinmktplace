import { describe, expect, it } from 'vitest';
import { getKpiDescription, KPI_DESCRIPTIONS } from '../kpi-descriptions';

// Every label/infoKey that renders a KpiInfoButton across the app once later tasks land.
const ALL_EXPECTED_KEYS = [
  // Dashboard
  'Faturamento bruto',
  'Líquido das vendas',
  'Líquido no faturamento',
  'Markup no período',
  'Compradores',
  'A receber',
  'Pedidos::Dashboard',
  'Ticket médio::Dashboard',
  // Publicados
  'Faturamento::Publicados',
  'Unidades vendidas',
  'Pedidos::Publicados',
  'Ticket médio::Publicados',
  'Lucro no período',
  'Saúde dos anúncios',
  'Encalhados (sem venda no período)',
  'Top produtos (faturamento)',
  // Financeiro
  'Líquido das vendas (você recebe)',
  'Taxas e frete (ML)',
  'Estornos',
  'Ticket médio líquido',
  'Já liberado',
  'A liberar',
  'Vendas no período',
  'Lucro líquido no período',
  // Faturamento / aba Vendas
  'Faturamento::Faturamento/Vendas',
  'Líquido',
  'Pedidos::Faturamento/Vendas',
  'Unidades',
  'Ticket médio::Faturamento/Vendas',
  'Itens / pedido',
  'Markup',
  // Faturamento / aba Geografia
  'Estados atingidos',
  'Top estado',
  'Cidades',
  'Concentração',
  'Sem localização',
  // Páginas de detalhe (drill-down)
  'Líquido total (você recebe)',
  'Faturamento total',
  // Estoque
  'SKUs cadastrados',
  'Unidades em estoque',
  'SKUs sem estoque',
  'Valor em estoque',
  // Carteira (Central)
  'Faturamento bruto da carteira',
  'Previsão de cobrança',
  'Pendências da carteira',
  'Organizações da carteira',
  // Pulse
  'No radar',
  'Mais caro que o mercado',
  'Você é o menor preço',
  'Sem vínculo de catálogo',
  // Pulse / Sonar — "Mercado endereçável" é o número mais forte da demo e era o menos explicado.
  'Vendas acumuladas',
  'Mercado endereçável',
  'Concorrentes vendendo mais que há um ano',
  'Média mensal por vendedor (12 meses)',
  // Ads (filtros do ranking de famílias)
  'Todas::Ads',
  'Acima do equilíbrio::Ads',
  'Dentro do equilíbrio::Ads',
  'Sem referência::Ads',
  'ACOS direto::Ads',
  'Equilíbrio observado::Ads',
  'Família::Ads',
  'Investimento::Ads',
  'Resultado após Ads::Ads',
  // Ads: faixa de KPIs, tabela de campanhas, competitividade, resumo e série (Task 36)
  'Vendas por Ads::Ads',
  'Vendas Ads::Ads',
  'Receita Ads::Ads',
  'ROAS::Ads',
  'ACOS::Ads',
  'TACOS da conta::Ads',
  'Impressões::Ads',
  'Cliques::Ads',
  'CTR::Ads',
  'CPC::Ads',
  'Conversão::Ads',
  'Ganhas::Ads',
  'Perdidas por orçamento::Ads',
  'Perdidas por classificação::Ads',
  'Lucro antes de Ads::Ads',
  'Despesa de Ads::Ads',
  'Resultado parcial após Ads::Ads',
  'Outras vendas::Ads',
];

describe('kpi-descriptions', () => {
  // M4: chave sem rótulo visível na tela é texto morto (cartões de filtro de Campanhas removidos; sem rótulo
  // "Equilíbrio no preço atual" nem "Unidades vendidas" no /ads).
  it('sem chaves mortas do /ads', () => {
    const mortas = ['Todas::Campanhas', 'Em alerta::Campanhas', 'Sem referência::Campanhas',
      'Equilíbrio no preço atual::Ads', 'Unidades vendidas::Ads'];
    expect(mortas.filter((k) => k in KPI_DESCRIPTIONS)).toEqual([]);
  });

  it('has a non-empty description for every KPI key used in the app', () => {
    const faltando = ALL_EXPECTED_KEYS.filter((k) => !getKpiDescription(k));
    expect(faltando).toEqual([]);
  });

  it('every dictionary entry is non-empty text', () => {
    for (const [key, texto] of Object.entries(KPI_DESCRIPTIONS)) {
      expect(texto.trim().length, `descrição vazia para "${key}"`).toBeGreaterThan(0);
    }
  });

  it('returns undefined for an unknown key (silent, no throw)', () => {
    expect(getKpiDescription('KPI que não existe')).toBeUndefined();
  });

  it('resolves the exact markup formula text for the non-divergent "Markup no período"', () => {
    expect(getKpiDescription('Markup no período')).toMatch(/custo/);
  });

  it('"Mercado endereçável" diz que é acumulado da vida dos anúncios, não TAM anual', () => {
    expect(getKpiDescription('Mercado endereçável')).toMatch(/vida dos anúncios/i);
    expect(getKpiDescription('Mercado endereçável')).not.toMatch(/por ano|anual|mensal/i);
  });

  it('"Investimento::Ads" cobre conta, campanha e a regra da família', () => {
    const d = getKpiDescription('Investimento::Ads') ?? '';
    expect(d).toMatch(/conta/i);
    expect(d).toMatch(/campanha/i);
    expect(d).toMatch(/exclusiv/i);
    expect(d).toMatch(/não é rateado|sem rateio/i);
  });

  it('Ads: "parcial" é cobertura de custo; "estimado" é descrito à parte', () => {
    const lucro = getKpiDescription('Lucro antes de Ads::Ads') ?? '';
    expect(lucro).not.toMatch(/estimado ou parcial/i);
    expect(lucro).toMatch(/estimado/i);
    const res = getKpiDescription('Resultado parcial após Ads::Ads') ?? '';
    expect(res).not.toMatch(/parcial ou estimado/i);
    expect(res).toMatch(/Estimado/);
  });
});
