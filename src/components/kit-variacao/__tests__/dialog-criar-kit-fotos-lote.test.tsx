// ADR-0200 (adendo 11/11): fotos em lote na etapa 2. Gerar todas (fila de 3), Gerar de novo todas (confirma o custo),
// Aprovar todas (só pela grade em tamanho real) e nenhuma foto cobrada perdida ao sair da etapa.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DialogCriarKitVariacao } from '../dialog-criar-kit-variacao';
import { gerarFotoKitEdge } from '@/lib/kit-variacao-edge';

const v = (codigo: string, cor: string) => ({
  codigo, cor, tamanho: 'M', estoque: 9, preco: 49.9, precoPublicacao: 49.9, excluidaDaPublicacao: false,
  custo: 20, pesoGramas: 200, alturaCm: 3, larguraCm: 20, comprimentoCm: 30,
});
const familia = {
  data: {
    id: 'FAM', codigoPai: '0001', titulo: 'Short', origem: 'nacional', categoriaMlId: 'MLB1',
    variacoes: [v('P-M', 'Preto'), v('B-M', 'Branco'), v('A-M', 'Azul'), v('C-M', 'Caqui')],
  },
  isLoading: false, isError: false,
};
vi.mock('@/hooks/useFamilia', () => ({ useFamilia: () => familia }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: ['kit_variacao', 'imagem_ia'] }) }));
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => ({ data: { nacional: 8, importado: 16, confirmada: true }, isLoading: false, isError: false, isFetched: true }) }));
vi.mock('@/lib/kit-variacao-edge', () => ({
  criarKitVariacaoEdge: vi.fn(async () => ({ ok: true, kit_id: 'K1' })),
  enviarFotoKit: vi.fn(async () => 'ORG/x.jpg'),
  gerarTextoKitEdge: vi.fn(async () => ({ ok: true, titulo: 'Kit 2 Shorts', descricao: 'Kit com 2 peças.', previa_id: 'PV1' })),
  gerarFotoKitEdge: vi.fn(),
  fetchPrecoAvulsoKit: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/tarifa', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tarifa')>('@/lib/tarifa');
  return { ...actual, calcularTarifaML: vi.fn(async () => ({ classico: { comissao: 12, percentual: 12, fixa: 0, imposto: 8, recebe: 70 }, premium: { comissao: 17, percentual: 17, fixa: 0, imposto: 8, recebe: 65 }, frete: 10, proveniencia: 'official' })) };
});

const gerada = (id: string) => ({
  ok: true as const, path: `ORG/kit-variacao-ia/${id}.png`, url: `https://x/${id}.png`, aprovado: true,
  verificacao: { aprovado: true, itens: [{ campo: 'cor', rotulo: 'Cor', ok: true, nota: '' }], motivos: [] as string[] },
  originais: [{ cor: 'Preto', urls: ['https://x/o.png'] }],
});

function abrir() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DialogCriarKitVariacao familiaBaseId="FAM" open onOpenChange={() => {}} isAdmin={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
/** Cores marcadas, 2 peças: combinações; 1 kit em cada. Vai para a etapa 2. */
async function irParaAnuncio(user: ReturnType<typeof userEvent.setup>, cores: string[]) {
  for (const c of cores) await user.click(screen.getByRole('checkbox', { name: `Cor ${c}` }));
  for (const input of screen.getAllByLabelText(/^Quantidade /)) await user.type(input, '1');
  await user.click(screen.getByRole('button', { name: 'Próximo' }));
  await screen.findByDisplayValue('Kit 2 Shorts');
}
const carregarPrevias = () => screen.queryAllByRole('img', { name: /^Foto gerada / }).forEach((img) => fireEvent.load(img));

describe('DialogCriarKitVariacao: fotos em lote', () => {
  beforeEach(() => {
    vi.mocked(gerarFotoKitEdge).mockReset();
    let n = 0;
    vi.mocked(gerarFotoKitEdge).mockImplementation(async () => gerada(`g${++n}`));
  });

  it('"Gerar todas" gera uma por combinação sem foto e não toca a que tem foto enviada', async () => {
    const user = userEvent.setup();
    abrir();
    await irParaAnuncio(user, ['Preto', 'Branco', 'Azul']); // 3 combinações
    await user.upload(screen.getByLabelText('Foto Preto e Branco'), new File(['x'], 'pb.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: 'Gerar todas (2)' }));
    await screen.findByRole('img', { name: 'Foto gerada Branco e Azul' });
    await screen.findByRole('img', { name: 'Foto gerada Preto e Azul' });
    expect(gerarFotoKitEdge).toHaveBeenCalledTimes(2);
    expect(vi.mocked(gerarFotoKitEdge).mock.calls.map((c) => c[0].cores.join('+')).sort()).toEqual(['Branco+Azul', 'Preto+Azul']);
    expect(screen.queryByRole('img', { name: 'Foto gerada Preto e Branco' })).toBeNull();
  });

  it('a fila nunca passa de 3 gerações simultâneas', async () => {
    let emCurso = 0; let maximo = 0;
    const libera: Array<() => void> = [];
    vi.mocked(gerarFotoKitEdge).mockImplementation(async (p) => {
      emCurso++; maximo = Math.max(maximo, emCurso);
      await new Promise<void>((ok) => libera.push(ok));
      emCurso--;
      return gerada(p.requestId);
    });
    const user = userEvent.setup();
    abrir();
    await irParaAnuncio(user, ['Preto', 'Branco', 'Azul', 'Caqui']); // 6 combinações
    await user.click(screen.getByRole('button', { name: 'Gerar todas (6)' }));
    await vi.waitFor(() => expect(libera.length).toBe(3));
    // Gerando: não dá para voltar nem seguir (a candidata vive nesta etapa).
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeDisabled();
    while (libera.length) { libera.shift()!(); await vi.waitFor(() => expect(emCurso).toBeLessThanOrEqual(3)); await new Promise((r) => setTimeout(r, 0)); }
    await vi.waitFor(() => expect(gerarFotoKitEdge).toHaveBeenCalledTimes(6));
    while (libera.length) libera.shift()!();
    expect(maximo).toBe(3);
  });

  it('"Aprovar todas" só aprova pela grade em tamanho real, depois de "Confirmar"', async () => {
    const user = userEvent.setup();
    abrir();
    await irParaAnuncio(user, ['Preto', 'Branco', 'Azul']);
    await user.click(screen.getByRole('button', { name: 'Gerar todas (3)' }));
    await screen.findAllByRole('img', { name: /^Foto gerada / });
    await vi.waitFor(() => expect(screen.getAllByRole('img', { name: /^Foto gerada / })).toHaveLength(3));
    expect(screen.queryByRole('button', { name: /Aprovar todas/ })).toBeNull(); // prévias ainda não carregaram
    carregarPrevias();
    await user.click(await screen.findByRole('button', { name: 'Aprovar todas (3)' }));
    const grade = await screen.findByRole('dialog', { name: 'Aprovar 3 fotos' });
    // Nada aprovado antes de confirmar.
    expect(screen.getByText('Envie a foto de cada combinação (3 faltando).')).toBeInTheDocument();
    expect(within(grade).getAllByRole('img', { name: /^Foto gerada .*, tamanho real$/ })).toHaveLength(3);
    within(grade).getAllByRole('img', { name: /tamanho real$/ }).forEach((img) => fireEvent.load(img));
    await user.click(within(grade).getByRole('button', { name: 'Confirmar 3 fotos' }));
    await vi.waitFor(() => expect(screen.queryByText(/faltando/)).toBeNull());
  });

  it('"Gerar de novo todas" avisa quantas fotos novas serão cobradas antes de gerar', async () => {
    const user = userEvent.setup();
    abrir();
    await irParaAnuncio(user, ['Preto', 'Branco', 'Azul']);
    await user.click(screen.getByRole('button', { name: 'Gerar todas (3)' }));
    await vi.waitFor(() => expect(screen.getAllByRole('img', { name: /^Foto gerada / })).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Gerar de novo todas (3)' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('3 fotos novas serão cobradas');
    expect(gerarFotoKitEdge).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole('button', { name: 'Gerar 3 fotos' }));
    await vi.waitFor(() => expect(gerarFotoKitEdge).toHaveBeenCalledTimes(6));
  });

  it('com foto gerada e não aprovada, "Voltar" pede confirmação (a foto já foi cobrada)', async () => {
    const user = userEvent.setup();
    abrir();
    await irParaAnuncio(user, ['Preto', 'Branco', 'Azul']);
    await user.click(screen.getByRole('button', { name: 'Gerar todas (3)' }));
    await vi.waitFor(() => expect(screen.getAllByRole('img', { name: /^Foto gerada / })).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('3 fotos geradas serão descartadas');
    await user.click(screen.getByRole('button', { name: 'Ficar e revisar' }));
    expect(screen.getAllByRole('img', { name: /^Foto gerada / })).toHaveLength(3);
  });
});
