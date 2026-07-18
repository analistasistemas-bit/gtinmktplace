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
  'Sem localização',
  // Páginas de detalhe (drill-down)
  'Líquido total (você recebe)',
  'Faturamento total',
];

describe('kpi-descriptions', () => {
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
});
