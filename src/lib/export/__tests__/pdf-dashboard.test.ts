import { describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import { escalaDashboard, gerarPdfDashboard } from '../pdf-dashboard';
import { dashboardPdfFixture } from './pdf-dashboard-fixture';

const jspdfState = vi.hoisted(() => ({
  textSpies: [] as unknown[],
}));

vi.mock('jspdf', async (importOriginal) => {
  const original = await importOriginal<typeof import('jspdf')>();
  function JsPdfComSpy(...args: ConstructorParameters<typeof original.jsPDF>) {
    const doc = new original.jsPDF(...args);
    jspdfState.textSpies.push(vi.spyOn(doc, 'text'));
    return doc;
  }
  JsPdfComSpy.API = original.jsPDF.API;
  return { ...original, jsPDF: JsPdfComSpy };
});

describe('escalaDashboard', () => {
  it('cria escala segura para vazio, nulos e um ponto', () => {
    expect(escalaDashboard([], 'faturamento')).toEqual({ min: 0, max: 1, ticks: [0, 0.5, 1] });
    expect(escalaDashboard([null, 456.56], 'liquido')).toMatchObject({ min: 0 });
    expect(escalaDashboard([9], 'pedidos')).toEqual({ min: 0, max: 9, ticks: [0, 3, 6, 9] });
  });

  it('mantém negativos dentro do domínio e ticks inteiros para pedidos', () => {
    expect(escalaDashboard([-20, 40], 'faturamento')).toMatchObject({ min: -20, max: 40 });
    expect(escalaDashboard([-2, 3], 'pedidos').ticks.every(Number.isInteger)).toBe(true);
  });
});

it('gera duas páginas A4 paisagem com os oito KPIs e a métrica selecionada', () => {
  const data = dashboardPdfFixture();
  const doc = gerarPdfDashboard(data, new Date('2026-07-20T10:31:00-03:00'));
  expect(doc.getNumberOfPages()).toBe(2);
  expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight());
  const pdf = doc.output();
  for (const texto of [
    'Dashboard',
    'Faturamento bruto',
    'R$ 456,56',
    'Líquido das vendas',
    'R$ 319,55',
    'Líquido no faturamento',
    'R$ 276,98',
    'Markup no período',
    '+35%',
    'Compradores',
    '7',
    'Pedidos',
    '9',
    'Ticket médio',
    'R$ 50,73',
    'A receber',
    'Evolução de vendas',
    'Métrica: Pedidos',
    '20/07',
    'Top produtos do período',
    'Liberações próximas',
    'Vendas por estado',
    'Página 2 de 2',
  ]) {
    expect(pdf).toContain(texto);
  }
});

it('renderiza delta e auxiliar dos KPIs secundários', () => {
  const data = dashboardPdfFixture();
  data.secundarios[0] = {
    ...data.secundarios[0],
    delta: '+139% vs. anterior',
    tendencia: 'up',
    auxiliar: 'valor após descontos',
  };
  const pdf = gerarPdfDashboard(data).output();
  expect(pdf).toContain('+139% vs. anterior');
  expect(pdf).toContain('valor após descontos');
});

it('alinha os cinco faturamentos à direita sem sobrepor os títulos', () => {
  const produtos = Array.from({ length: 5 }, (_, i) => ({
    posicao: i + 1,
    titulo: `Produto ${i + 1} com título deliberadamente longo para testar a coluna`,
    unidades: i + 1,
    faturamento: (i + 1) * 100,
  }));

  const doc = gerarPdfDashboard(dashboardPdfFixture({ produtos }));
  const text = jspdfState.textSpies.at(-1) as ReturnType<typeof vi.spyOn> | undefined;
  expect(text).toBeDefined();
  const chamadas = text?.mock.calls ?? [];
  const chamadasValores = chamadas.filter(([valor]) =>
    typeof valor === 'string' && /^R\$\s[1-5]00,00$/.test(valor),
  );
  expect(chamadasValores).toHaveLength(5);
  expect(new Set(chamadasValores.map(([, x]) => x))).toHaveLength(1);
  for (const [, , , options] of chamadasValores) {
    expect(options).toEqual(expect.objectContaining({ align: 'right' }));
  }

  const chamadasTitulos = chamadas.filter(([valor]) =>
    typeof valor === 'string' && /^\d\. Produto/.test(valor),
  );
  expect(chamadasTitulos).toHaveLength(5);
  for (const [i, [titulo, x, y]] of chamadasTitulos.entries()) {
    const [valor, valorX] = chamadasValores[i];
    const inicioValor = (valorX as number) - doc.getTextWidth(valor as string);
    expect((x as number) + doc.getTextWidth(titulo as string)).toBeLessThan(inicioValor);
    expect(chamadasValores[i][2]).toBe(y);
  }
  text?.mockRestore();
});

it('preenche suavemente a área sob a série sem rasterizar', () => {
  const pdf = gerarPdfDashboard(dashboardPdfFixture({
    serie: [
      { rotulo: '19/07', valor: 5 },
      { rotulo: '20/07', valor: 9 },
    ],
  })).output();
  expect(pdf).toContain('0.86 0.91 1. rg');
});

it.each([
  ['faturamento', 'Faturamento'],
  ['liquido', 'Líquido'],
  ['pedidos', 'Pedidos'],
] as const)('identifica visualmente a métrica %s no gráfico', (metrica, rotulo) => {
  const pdf = gerarPdfDashboard(dashboardPdfFixture({ metrica })).output();
  expect(pdf).toContain(`Métrica: ${rotulo}`);
});

it('expõe os estados vazios do relatório completo', () => {
  const pdf = gerarPdfDashboard(dashboardPdfFixture({
    serie: [],
    produtos: [],
    liberacoes: [],
    geografia: [],
  })).output();
  for (const texto of [
    'Sem vendas no período',
    'Sem produtos no período',
    'Nada a liberar no horizonte',
    'Sem vendas com destino no período',
  ]) {
    expect(pdf).toContain(texto);
  }
});

it('não rasteriza o relatório', () => {
  const api = jsPDF.API as unknown as { addImage: (...args: unknown[]) => unknown };
  const addImage = vi.spyOn(api, 'addImage');
  gerarPdfDashboard(dashboardPdfFixture());
  expect(addImage).not.toHaveBeenCalled();
  addImage.mockRestore();
});
