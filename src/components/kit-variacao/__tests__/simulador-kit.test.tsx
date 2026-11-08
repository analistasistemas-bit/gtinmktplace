import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SimuladorKit } from '../simulador-kit';
import { calcularTarifaML, type Tarifa } from '@/lib/tarifa';

vi.mock('@/lib/tarifa', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tarifa')>('@/lib/tarifa');
  return { ...actual, calcularTarifaML: vi.fn() };
});
const aliquotas = { data: { nacional: 8, importado: 16, confirmada: true }, isLoading: false, isError: false, isFetched: true };
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => aliquotas }));
const peca = (cor: string, custo: number) => ({
  cor, tamanho: 'M', custo, pesoGramas: 200, alturaCm: 3, larguraCm: 20, comprimentoCm: 30,
});
vi.mock('@/hooks/useFamilia', () => ({
  useFamilia: () => ({
    data: { origem: 'nacional', categoriaMlId: 'MLB1', variacoes: [peca('Preto', 20), peca('Branco', 25), peca('Marrom', 40)] },
    isLoading: false, isError: false,
  }),
}));

function tarifa(preco: number, frete: number, aliquotaPct: number): Tarifa {
  const imposto = Math.round(preco * aliquotaPct) / 100;
  const comissao = Math.round(preco * 12) / 100;
  const tipo = { comissao, percentual: 12, fixa: 0, imposto, recebe: Math.round((preco - comissao - frete - imposto) * 100) / 100 };
  return { classico: tipo, premium: tipo, frete, proveniencia: 'official' };
}

const props = {
  familiaBaseId: 'fam-1', cores: ['Preto', 'Branco', 'Marrom'], pecas: 2,
  quantidades: [
    { cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 2 },
    { cores: ['Preto', 'Marrom'], tamanho: 'M', quantidade: 1 },
  ],
};

function renderSim(preco: number, onPodeSeguir = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (p: number) => <QueryClientProvider client={qc}><SimuladorKit {...props} preco={p} onPodeSeguir={onPodeSeguir} /></QueryClientProvider>;
  const r = render(ui(preco));
  return { ...r, mudarPreco: (p: number) => r.rerender(ui(p)), onPodeSeguir };
}

describe('SimuladorKit', () => {
  beforeEach(() => {
    vi.mocked(calcularTarifaML).mockReset();
    vi.mocked(calcularTarifaML).mockImplementation(async (preco, _c, _d, aliq = 0) => tarifa(preco, 10, aliq));
    aliquotas.data = { nacional: 8, importado: 16, confirmada: true };
  });

  it('mostra a pior combinação com o card de Promoções e libera sem confirmação', async () => {
    const { onPodeSeguir } = renderSim(100);
    // recebe 100 − 12 − 10 − 8 = 70; Preto+Marrom custa 60 → lucro 10
    expect(await screen.findByText(/Pior combinação/)).toHaveTextContent('Preto e Marrom · M');
    expect(screen.getByText(/preço do kit/)).toBeInTheDocument();
    expect(screen.getByText('R$ 10,00')).toBeInTheDocument();
    expect(screen.queryByText('Seguir mesmo assim')).toBeNull();
    await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(true));
    expect(calcularTarifaML).toHaveBeenCalledWith(100, 'MLB1', { pesoGramas: 400, alturaCm: 6, larguraCm: 20, comprimentoCm: 30 }, 8);
  });

  it('prejuízo exige confirmação explícita', async () => {
    const { onPodeSeguir } = renderSim(70);
    expect(await screen.findByText(/dá prejuízo/)).toBeInTheDocument();
    expect(onPodeSeguir).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByLabelText('Seguir mesmo assim'));
    await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(true));
  });

  it('cotação indisponível não mostra número e exige confirmação', async () => {
    vi.mocked(calcularTarifaML).mockResolvedValue(null);
    const { onPodeSeguir } = renderSim(100);
    expect(await screen.findByText(/Não foi possível calcular o lucro/)).toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).toBeNull();
    expect(onPodeSeguir).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText('Seguir mesmo assim')).toBeInTheDocument();
  });

  it('sem alíquota confirmada: avisa e não calcula imposto', async () => {
    aliquotas.data = { nacional: 8, importado: 16, confirmada: false };
    renderSim(100);
    expect(await screen.findByText(/Imposto fora da conta/)).toBeInTheDocument();
    expect(screen.queryByText(/imposto −/)).toBeNull();
    expect(calcularTarifaML).toHaveBeenCalledWith(100, 'MLB1', expect.anything(), 0);
    expect(screen.getByText('Lucro calculado sem imposto.')).toBeInTheDocument();
  });

  it('preço novo recota e nunca mostra o lucro do preço anterior', async () => {
    const { mudarPreco } = renderSim(100);
    await screen.findByText('R$ 10,00');
    mudarPreco(120);
    expect(screen.queryByText('R$ 10,00')).toBeNull();
    expect(screen.getByText(/Calculando/)).toBeInTheDocument();
    // recebe 120 − 14,40 − 10 − 9,60 = 86 → lucro 26
    expect(await screen.findByText('R$ 26,00', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(calcularTarifaML).toHaveBeenCalledWith(120, 'MLB1', expect.anything(), 8);
  });

  it('expande o lucro de cada combinação', async () => {
    renderSim(100);
    await userEvent.click(await screen.findByRole('button', { name: /Ver lucro de cada combinação/ }));
    expect(screen.getByText(/Preto e Branco · M/)).toBeInTheDocument();
    expect(screen.getByText(/lucro R\$ 25,00/)).toBeInTheDocument();
  });
});
