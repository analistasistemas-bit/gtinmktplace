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
const familiaBase = {
  data: { origem: 'nacional', categoriaMlId: 'MLB1', variacoes: [peca('Preto', 20), peca('Branco', 25), peca('Marrom', 40)] },
  isLoading: false, isError: false as boolean,
};
const useFamiliaMock = vi.fn((..._args: unknown[]) => familiaBase);
vi.mock('@/hooks/useFamilia', () => ({ useFamilia: (...a: unknown[]) => useFamiliaMock(...a) }));

function tarifa(preco: number, frete: number, aliquotaPct: number): Tarifa {
  const imposto = Math.round(preco * aliquotaPct) / 100;
  const tipo = (pct: number) => {
    const comissao = Math.round(preco * pct) / 100;
    return { comissao, percentual: pct, fixa: 0, imposto, recebe: Math.round((preco - comissao - frete - imposto) * 100) / 100 };
  };
  return { classico: tipo(12), premium: tipo(17), frete, proveniencia: 'official' };
}

const props = {
  familiaBaseId: 'fam-1', cores: ['Preto', 'Branco', 'Marrom'], pecas: 2,
  quantidades: [
    { cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 2 },
    { cores: ['Preto', 'Marrom'], tamanho: 'M', quantidade: 1 },
  ],
};

type Extra = Partial<Pick<Parameters<typeof SimuladorKit>[0], 'tipo' | 'quantidades'>>;
function renderSim(preco: number, onPodeSeguir = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (p: number, extra: Extra = {}) => (
    <QueryClientProvider client={qc}><SimuladorKit {...props} {...extra} preco={p} onPodeSeguir={onPodeSeguir} /></QueryClientProvider>
  );
  const r = render(ui(preco));
  return { ...r, mudarPreco: (p: number) => r.rerender(ui(p)), mudar: (extra: Extra) => r.rerender(ui(preco, extra)), onPodeSeguir };
}

describe('SimuladorKit', () => {
  beforeEach(() => {
    vi.mocked(calcularTarifaML).mockReset();
    vi.mocked(calcularTarifaML).mockImplementation(async (preco, _c, _d, aliq = 0) => tarifa(preco, 10, aliq));
    aliquotas.data = { nacional: 8, importado: 16, confirmada: true };
    familiaBase.data.variacoes = [peca('Preto', 20), peca('Branco', 25), peca('Marrom', 40)];
    familiaBase.isError = false;
    useFamiliaMock.mockClear();
  });

  it('custo vem da própria base, a mesma fonte da edge (sem custo recente de outra família)', async () => {
    renderSim(100);
    await screen.findByText(/Menor lucro:/);
    expect(useFamiliaMock).toHaveBeenCalledWith('fam-1', true, false);
  });

  it('peça sem custo na base bloqueia sem lucro e sem "Seguir mesmo assim"', async () => {
    familiaBase.data.variacoes = [peca('Preto', 20), { ...peca('Branco', 25), custo: null as unknown as number }, peca('Marrom', 40)];
    const { onPodeSeguir } = renderSim(100);
    expect(await screen.findByText(/sem custo na base/)).toBeInTheDocument();
    expect(screen.queryByText(/Menor lucro:/)).toBeNull();
    expect(screen.queryByLabelText('Seguir mesmo assim')).toBeNull();
    expect(onPodeSeguir).toHaveBeenLastCalledWith(false);
  });

  it('mostra a combinação de menor lucro com o card de Promoções e libera sem confirmação', async () => {
    const { onPodeSeguir } = renderSim(100);
    // recebe 100 − 12 − 10 − 8 = 70; Preto+Marrom custa 60 → lucro 10
    expect(await screen.findByText(/Menor lucro:/)).toHaveTextContent('Preto e Marrom · M');
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

  it('enquanto recota não libera seguir; libera quando a conta nova chega', async () => {
    const { mudarPreco, onPodeSeguir } = renderSim(100);
    await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(true));
    mudarPreco(120);
    expect(onPodeSeguir).toHaveBeenLastCalledWith(false);
    expect(screen.getByText(/Calculando/)).toBeInTheDocument();
    await screen.findByText('R$ 26,00', {}, { timeout: 2000 });
    await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(true));
  });

  it('mostra a variação do lucro em relação ao preço anterior', async () => {
    const { mudarPreco } = renderSim(100);
    await screen.findByText('R$ 10,00');
    expect(screen.queryByText(/em relação a/)).toBeNull();
    mudarPreco(120);
    expect(screen.queryByText(/em relação a/)).toBeNull();
    // lucro 10 → 26 na mesma pior combinação (Preto e Marrom)
    expect(await screen.findByText(/em relação a/, {}, { timeout: 2000 })).toHaveTextContent('+R$ 16,00 em relação a R$ 100,00');
  });

  it('preço zero não fica em "Calculando" nem libera seguir', async () => {
    const { onPodeSeguir } = renderSim(0);
    expect(screen.queryByText(/Calculando/)).toBeNull();
    expect(screen.queryByText(/R\$/)).toBeNull();
    expect(onPodeSeguir).toHaveBeenLastCalledWith(false);
    expect(calcularTarifaML).not.toHaveBeenCalled();
  });

  it('confirmação de prejuízo não volta ao retornar ao preço confirmado', async () => {
    const { onPodeSeguir, mudarPreco } = renderSim(70);
    await userEvent.click(await screen.findByLabelText('Seguir mesmo assim'));
    await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(true));
    const antes = onPodeSeguir.mock.calls.length;
    mudarPreco(75);
    await screen.findByText(/R\$ 75,00/, {}, { timeout: 2000 });
    mudarPreco(70);
    await screen.findByText(/R\$ 70,00/, {}, { timeout: 2000 });
    await screen.findByText(/dá prejuízo/);
    expect(screen.getByLabelText('Seguir mesmo assim')).not.toBeChecked();
    expect(onPodeSeguir.mock.calls.slice(antes).some(([v]) => v === true)).toBe(false);
  });

  it('expande o lucro de cada combinação', async () => {
    renderSim(100);
    await userEvent.click(await screen.findByRole('button', { name: /Ver lucro de cada combinação/ }));
    expect(screen.getByText(/Preto e Branco · M/)).toBeInTheDocument();
    expect(screen.getByText(/lucro R\$ 25,00/)).toBeInTheDocument();
  });

  it.each([
    ['tipo de anúncio', { tipo: 'gold_pro' as const }],
    ['combinações', { quantidades: [{ cores: ['Branco', 'Marrom'], tamanho: 'M', quantidade: 1 }] }],
  ])('confirmação de prejuízo não sobrevive à troca de %s', async (_nome, extra) => {
    const { onPodeSeguir, mudar } = renderSim(70);
    await userEvent.click(await screen.findByLabelText('Seguir mesmo assim'));
    await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(true));
    const antes = onPodeSeguir.mock.calls.length;
    mudar(extra);
    await screen.findByText(/dá prejuízo/);
    expect(screen.getByLabelText('Seguir mesmo assim')).not.toBeChecked();
    expect(onPodeSeguir.mock.calls.slice(antes).some(([v]) => v === true)).toBe(false);
  });

  it('todas as combinações com o mesmo lucro: diz que é igual em todas e não marca nenhuma', async () => {
    familiaBase.data.variacoes = [peca('Preto', 20), peca('Branco', 20), peca('Marrom', 20)];
    renderSim(100);
    expect(await screen.findByText('Mesmo lucro em todas as combinações')).toBeInTheDocument();
    expect(screen.queryByText(/Menor lucro:/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Ver lucro de cada combinação/ }));
    expect(screen.queryByText('(menor lucro)')).toBeNull();
  });

  it('peça excluída da publicação bloqueia como sku_inexistente, sem "Seguir mesmo assim"', async () => {
    familiaBase.data.variacoes = [peca('Preto', 20), { ...peca('Branco', 25), excluidaDaPublicacao: true } as ReturnType<typeof peca>, peca('Marrom', 40)];
    const { onPodeSeguir } = renderSim(100);
    expect(await screen.findByText(/não tem uma das peças/)).toBeInTheDocument();
    expect(screen.queryByText(/Menor lucro:/)).toBeNull();
    expect(screen.queryByLabelText('Seguir mesmo assim')).toBeNull();
    expect(onPodeSeguir).toHaveBeenLastCalledWith(false);
  });

  it('falha na releitura da base não deixa número antigo na expansão', async () => {
    const { mudarPreco } = renderSim(100);
    await userEvent.click(await screen.findByRole('button', { name: /Ver lucro de cada combinação/ }));
    expect(screen.getByText(/lucro R\$ 25,00/)).toBeInTheDocument();
    familiaBase.isError = true; // react-query conserva o data anterior
    mudarPreco(100);
    expect(await screen.findByText(/Não foi possível ler custos/)).toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).toBeNull();
    expect(screen.queryByText('(menor lucro)')).toBeNull();
  });
});
