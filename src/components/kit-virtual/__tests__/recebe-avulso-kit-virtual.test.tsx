// Task 7: card "Você recebe vendendo avulso" — tarifa oficial por componente, sem presumir nada.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecebeAvulsoKitVirtual } from '../recebe-avulso-kit-virtual';
import type { ComponenteSelecionadoKitVirtual } from '@/lib/kit-virtual';
import type { Tarifa } from '@/lib/tarifa';

vi.mock('@/lib/tarifa', async (orig) => ({ ...(await orig<typeof import('@/lib/tarifa')>()), calcularTarifaML: vi.fn() }));
import { calcularTarifaML } from '@/lib/tarifa';
const calc = vi.mocked(calcularTarifaML);

let aliquotas: { nacional: number; importado: number; confirmada: boolean } | undefined = { nacional: 8, importado: 16, confirmada: true };
let aliquotasCarregando = false;
let aliquotasErro = false;
vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: aliquotas, isFetched: !aliquotasCarregando, isLoading: aliquotasCarregando, isError: aliquotasErro }),
}));

const tipo = (recebe: number) => ({ comissao: 10, percentual: 14, fixa: 0, imposto: 8, recebe });
const tarifa = (over: Partial<Tarifa> = {}): Tarifa => ({ classico: tipo(60), premium: tipo(55), frete: 5, proveniencia: 'official', ...over });
const medidas = { alturaCm: 10, larguraCm: 10, comprimentoCm: 10, pesoGramas: 300 };

const comp = (over: Partial<ComponenteSelecionadoKitVirtual['candidato']> = {}, quantidade = 2): ComponenteSelecionadoKitVirtual => ({
  quantidade, precoAtualML: 100,
  candidato: {
    userProductId: 'UP1', itemId: 'MLB1', title: 'Shampoo', type: 'available', thumbnailUrl: null, categoryName: null,
    estoque: 5, reasons: [], codigo: '001', codigoPai: null, custo: 40, origem: 'nacional', kitMultiplicador: null,
    precoAtualML: 100, categoriaMlId: 'MLB123', listingTypeId: 'gold_special', medidas, ...over,
  },
});

function ui(componentes: ComponenteSelecionadoKitVirtual[], liquidoKit: number | null = 90) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RecebeAvulsoKitVirtual componentes={componentes} liquidoKit={liquidoKit} /></QueryClientProvider>);
}

describe('RecebeAvulsoKitVirtual', () => {
  beforeEach(() => { calc.mockReset(); calc.mockResolvedValue(tarifa()); aliquotas = { nacional: 8, importado: 16, confirmada: true }; aliquotasCarregando = false; aliquotasErro = false; });
  afterEach(cleanup);

  it('com custo: recebe e lucro; rodapé com os dois totais e aviso do frete', async () => {
    ui([comp()]);
    expect(await screen.findByText('Separado (× qtd): R$ 120,00 · No kit: R$ 90,00')).toBeInTheDocument();
    expect(screen.getAllByText('R$ 20,00').length).toBeGreaterThan(0);
    expect(screen.getByText(/frete do kit é estimativa \(0\)/)).toBeInTheDocument();
    expect(calc).toHaveBeenCalledWith(100, 'MLB123', medidas, 8);
  });

  it('sem custo: mostra recebe, "custo não cadastrado" e nenhum lucro', async () => {
    ui([comp({ custo: null })]);
    expect(await screen.findByText('custo não cadastrado')).toBeInTheDocument();
    expect(screen.getAllByText('R$ 60,00').length).toBeGreaterThan(0);
    expect(screen.queryByText('Você recebe por venda')).toBeNull();
  });

  it('tarifa não oficial: indisponível, sem número', async () => {
    calc.mockResolvedValue(tarifa({ proveniencia: 'estimated' }));
    ui([comp()]);
    expect(await screen.findByText(/^indisponível/)).toBeInTheDocument();
    expect(screen.queryByText(/Separado/)).toBeNull();
  });

  it('medidas null: frete indisponível e não chama a tarifa', async () => {
    ui([comp({ medidas: null })]);
    expect(await screen.findByText(/^indisponível/)).toBeInTheDocument();
    expect(calc).not.toHaveBeenCalled();
  });

  it('listing type desconhecido e alíquota ausente: avisos, sem chamar a tarifa', async () => {
    aliquotas = undefined;
    ui([comp({ listingTypeId: null }), comp({ userProductId: 'UP2', origem: 'importado' })]);
    expect(await screen.findByText('tipo do anúncio desconhecido')).toBeInTheDocument();
    expect(screen.getByText('alíquota não confirmada')).toBeInTheDocument();
    expect(calc).not.toHaveBeenCalled();
  });

  it('alíquotas carregando: "calculando…", nunca "alíquota não confirmada"', async () => {
    aliquotas = undefined;
    aliquotasCarregando = true;
    ui([comp()]);
    expect(await screen.findByText('calculando…')).toBeInTheDocument();
    expect(screen.queryByText('alíquota não confirmada')).toBeNull();
  });

  it('erro ao ler alíquotas: "indisponível"', async () => {
    aliquotas = undefined;
    aliquotasErro = true;
    ui([comp()]);
    expect(await screen.findByText('indisponível')).toBeInTheDocument();
    expect(screen.queryByText('alíquota não confirmada')).toBeNull();
  });

  it('preço 0 com medidas e categoria: indisponível sem o sufixo de frete', async () => {
    ui([{ ...comp(), precoAtualML: 0 }]);
    expect(await screen.findByText('indisponível')).toBeInTheDocument();
    expect(screen.queryByText(/faltam medidas/)).toBeNull();
  });
});
