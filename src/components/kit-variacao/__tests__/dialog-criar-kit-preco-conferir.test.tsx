// Diálogo com o SimuladorKit real: editar o preço na etapa 3 recota e "Criar kit" espera a conta nova.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DialogCriarKitVariacao } from '../dialog-criar-kit-variacao';
import { calcularTarifaML, type Tarifa } from '@/lib/tarifa';

const v = (codigo: string, cor: string, custo: number) => ({
  codigo, cor, tamanho: 'M', estoque: 5, preco: 49.9, precoPublicacao: 49.9, excluidaDaPublicacao: false,
  custo, pesoGramas: 200, alturaCm: 3, larguraCm: 20, comprimentoCm: 30,
});
const familia = {
  data: {
    id: 'FAM', codigoPai: '0001', titulo: 'Blusa', origem: 'nacional', categoriaMlId: 'MLB1',
    variacoes: [v('P-M', 'Preto', 20), v('B-M', 'Branco', 25)],
  },
  isLoading: false, isError: false,
};
vi.mock('@/hooks/useFamilia', () => ({ useFamilia: () => familia }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: ['kit_variacao'] }) }));
const aliquotas = { data: { nacional: 8, importado: 16, confirmada: true }, isLoading: false, isError: false, isFetched: true };
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => aliquotas }));
vi.mock('@/lib/kit-variacao-edge', () => ({
  fetchPrecoAvulsoKit: vi.fn(async () => new Map()),
  criarKitVariacaoEdge: vi.fn(async () => ({ ok: true, kit_id: 'K1' })),
  enviarFotoKit: vi.fn(async () => 'ORG/x.jpg'),
  gerarTextoKitEdge: vi.fn(async () => ({ ok: true, titulo: 'Kit 2 Blusas', descricao: 'Kit com 2 peças.', previa_id: 'PV1' })),
  gerarFotoKitEdge: vi.fn(),
}));
vi.mock('@/lib/tarifa', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tarifa')>('@/lib/tarifa');
  return { ...actual, calcularTarifaML: vi.fn() };
});

function tarifa(preco: number): Tarifa {
  const imposto = Math.round(preco * 8) / 100;
  const tipo = (pct: number) => {
    const comissao = Math.round(preco * pct) / 100;
    return { comissao, percentual: pct, fixa: 0, imposto, recebe: Math.round((preco - comissao - 10 - imposto) * 100) / 100 };
  };
  return { classico: tipo(12), premium: tipo(17), frete: 10, proveniencia: 'official' };
}

describe('DialogCriarKitVariacao: preço na etapa Conferir', () => {
  it('editar o preço mostra "Calculando…" sem número velho e só libera "Criar kit" com a conta nova', async () => {
    // Cotação controlada: a de 120 só responde quando o teste mandar.
    let liberar120: (() => void) | undefined;
    vi.mocked(calcularTarifaML).mockImplementation((preco) => (preco === 120
      ? new Promise((ok) => { liberar120 = () => ok(tarifa(120)); })
      : Promise.resolve(tarifa(preco))));
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DialogCriarKitVariacao familiaBaseId="FAM" open onOpenChange={() => {}} isAdmin={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    for (const c of ['Preto', 'Branco']) await user.click(screen.getByRole('checkbox', { name: `Cor ${c}` }));
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.clear(screen.getByLabelText('Preço do kit'));
    await user.type(screen.getByLabelText('Preço do kit'), '100');
    await screen.findByDisplayValue('Kit 2 Blusas');
    await user.upload(screen.getByLabelText('Foto Preto e Branco'), new File(['x'], 'pb.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: 'Próximo' }));

    // 100 − 12 − 10 − 8 = 70; custo 45 → lucro 25
    expect(await screen.findByText('R$ 25,00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar kit' })).toBeEnabled();

    await user.clear(screen.getByLabelText('Preço do kit'));
    await user.type(screen.getByLabelText('Preço do kit'), '120');
    expect(screen.getByText(/Calculando o que você recebe/)).toBeInTheDocument();
    expect(screen.queryByText('R$ 25,00')).toBeNull();
    expect(screen.getByRole('button', { name: 'Criar kit' })).toBeDisabled();

    await vi.waitFor(() => expect(liberar120).toBeDefined(), { timeout: 2000 });
    expect(screen.getByRole('button', { name: 'Criar kit' })).toBeDisabled();
    liberar120!();
    // 120 − 14,40 − 10 − 9,60 = 86 → lucro 41 (+16 em relação a 100)
    expect(await screen.findByText('R$ 41,00')).toBeInTheDocument();
    expect(screen.getByText(/em relação a/)).toHaveTextContent('lucro R$ 41,00 (+R$ 16,00 em relação a R$ 100,00)');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Criar kit' })).toBeEnabled());
  });

  it('etapa 2 mostra "Você recebe por venda" e recalcula ao mudar o preço, sem o "Seguir mesmo assim"', async () => {
    vi.mocked(calcularTarifaML).mockImplementation(async (preco) => tarifa(preco));
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DialogCriarKitVariacao familiaBaseId="FAM" open onOpenChange={() => {}} isAdmin={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    for (const c of ['Preto', 'Branco']) await user.click(screen.getByRole('checkbox', { name: `Cor ${c}` }));
    await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.clear(screen.getByLabelText('Preço do kit'));
    await user.type(screen.getByLabelText('Preço do kit'), '100');
    // 100 − 12 − 10 − 8 = 70; custo 45 → lucro 25
    expect(await screen.findByText('R$ 25,00')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Simulador de lucro do kit' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Preço do kit'));
    await user.type(screen.getByLabelText('Preço do kit'), '50');
    // 50 − 6 − 10 − 4 = 30; custo 45 → prejuízo −15: avisa, mas a confirmação fica só na etapa 3.
    expect(await screen.findByText('Este preço dá prejuízo em pelo menos uma combinação.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Seguir mesmo assim' })).toBeNull();
  });
});
