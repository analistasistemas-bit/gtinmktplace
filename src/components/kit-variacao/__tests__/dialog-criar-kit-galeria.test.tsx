// ADR-0200 (adendo 12/11): galeria das peças na etapa 2 do Criar kit. O pedido leva só o que o operador manteve.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DialogCriarKitVariacao } from '../dialog-criar-kit-variacao';
import { calcularTarifaML, type Tarifa } from '@/lib/tarifa';
import { criarKitVariacaoEdge, fetchGaleriasPecasKit, fetchPrecoAvulsoKit } from '@/lib/kit-variacao-edge';
import type { GaleriaProposta } from '@/lib/kit-galeria';

const v = (codigo: string, cor: string, custo: number) => ({
  codigo, cor, tamanho: 'M', estoque: 5, preco: 49.9, precoPublicacao: 49.9, excluidaDaPublicacao: false,
  custo, pesoGramas: 200, alturaCm: 3, larguraCm: 20, comprimentoCm: 30,
});
const familia = {
  data: {
    id: 'FAM', codigoPai: '0001', titulo: 'Short', origem: 'nacional', categoriaMlId: 'MLB1',
    variacoes: [v('P-M', 'Preto', 20), v('B-M', 'Branco', 25)],
  },
  isLoading: false, isError: false,
};
vi.mock('@/hooks/useFamilia', () => ({ useFamilia: () => familia }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: ['kit_variacao'] }) }));
const aliquotas = { data: { nacional: 8, importado: 16, confirmada: true }, isLoading: false, isError: false, isFetched: true };
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => aliquotas }));
vi.mock('@/lib/kit-variacao-edge', () => ({
  criarKitVariacaoEdge: vi.fn(async () => ({ ok: true, kit_id: 'K1' })),
  enviarFotoKit: vi.fn(async () => 'ORG/x.jpg'),
  gerarTextoKitEdge: vi.fn(async () => ({ ok: true, titulo: 'Kit 2 Shorts', descricao: 'Kit com 2 peças.', previa_id: 'PV1' })),
  fetchPrecoAvulsoKit: vi.fn(),
  fetchGaleriasPecasKit: vi.fn(),
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

const GALERIA: GaleriaProposta = {
  fotos: [
    { id: 'P2', item: 'MLB-P', url: 'https://x/P2.jpg', cor: 'Preto' },
    { id: 'B3', item: 'MLB-B', url: 'https://x/B3.jpg', cor: 'Branco' },
    { id: 'P4', item: 'MLB-P', url: 'https://x/P4.jpg', cor: 'Preto' },
  ],
  avisos: [], indisponivel: false,
};

function abrir() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DialogCriarKitVariacao familiaBaseId="FAM" open onOpenChange={() => {}} isAdmin={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function irParaEtapa2(user: ReturnType<typeof userEvent.setup>) {
  for (const c of ['Preto', 'Branco']) await user.click(screen.getByRole('checkbox', { name: `Cor ${c}` }));
  await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
  await user.click(screen.getByRole('button', { name: 'Próximo' }));
  await user.clear(screen.getByLabelText('Preço do kit'));
  await user.type(screen.getByLabelText('Preço do kit'), '90');
  await screen.findByDisplayValue('Kit 2 Shorts');
  await user.upload(screen.getByLabelText('Foto Preto e Branco'), new File(['x'], 'pb.jpg', { type: 'image/jpeg' }));
}
async function criar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Próximo' }));
  const botao = screen.getByRole('button', { name: 'Criar kit' });
  await waitFor(() => expect(botao).toBeEnabled());
  await user.click(botao);
  await waitFor(() => expect(criarKitVariacaoEdge).toHaveBeenCalled());
  return vi.mocked(criarKitVariacaoEdge).mock.calls[0][0];
}

describe('DialogCriarKitVariacao: galeria das peças', () => {
  beforeEach(() => {
    vi.mocked(calcularTarifaML).mockImplementation(async (preco) => tarifa(preco));
    vi.mocked(fetchPrecoAvulsoKit).mockReset().mockResolvedValue(new Map());
    vi.mocked(criarKitVariacaoEdge).mockClear();
    vi.mocked(fetchGaleriasPecasKit).mockReset().mockResolvedValue({ 'Preto e Branco': GALERIA });
  });

  it('a etapa 2 mostra a prévia numerada e o pedido leva todas as fotos por padrão (intercalado ligado)', async () => {
    const user = userEvent.setup();
    abrir();
    await irParaEtapa2(user);
    const lista = await screen.findByRole('list', { name: 'Fotos das peças no anúncio' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(3);
    expect(vi.mocked(fetchGaleriasPecasKit)).toHaveBeenCalledWith('FAM', [{ rotulo: 'Preto e Branco', cores: ['Preto', 'Branco'] }]);
    const pedido = await criar(user);
    expect(pedido.galeria).toEqual({ 'Preto e Branco': ['P2', 'B3', 'P4'] });
  });

  it('operador removeu uma foto: o pedido enviado reflete', async () => {
    const user = userEvent.setup();
    abrir();
    await irParaEtapa2(user);
    await user.click(await screen.findByRole('button', { name: 'Remover foto 3 (Branco)' }));
    const pedido = await criar(user);
    expect(pedido.galeria).toEqual({ 'Preto e Branco': ['P2', 'P4'] });
  });

  it('"Só a foto do kit": o pedido sai sem galeria', async () => {
    const user = userEvent.setup();
    abrir();
    await irParaEtapa2(user);
    await user.click(await screen.findByRole('switch', { name: 'Só a foto do kit' }));
    const pedido = await criar(user);
    expect(pedido.galeria).toBeUndefined();
  });

  it('leitura das fotos das peças falhou: mostra "indisponíveis" e cria só com a foto do kit', async () => {
    vi.mocked(fetchGaleriasPecasKit).mockReset().mockRejectedValue(new Error('rede'));
    const user = userEvent.setup();
    abrir();
    await irParaEtapa2(user);
    expect(await screen.findByText(/fotos das peças indisponíveis/i)).toBeInTheDocument();
    const pedido = await criar(user);
    expect(pedido.galeria).toBeUndefined();
  });
});
