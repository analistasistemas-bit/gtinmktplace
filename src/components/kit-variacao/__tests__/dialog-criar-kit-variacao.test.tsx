import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DialogCriarKitVariacao } from '../dialog-criar-kit-variacao';

const v = (codigo: string, cor: string, tamanho: string, estoque: number) => ({
  codigo, cor, tamanho, estoque, preco: 49.9, precoPublicacao: 49.9, excluidaDaPublicacao: false,
  custo: 20, pesoGramas: 200, alturaCm: 3, larguraCm: 20, comprimentoCm: 30,
});
const familia = {
  data: {
    id: 'FAM', codigoPai: '0001', titulo: 'Blusa Canelada', origem: 'nacional', categoriaMlId: 'MLB3112',
    variacoes: [
      v('P-M', 'Preto', 'M', 2), v('B-M', 'Branco', 'M', 5), v('M-M', 'Marrom', 'M', 5),
      v('P-G', 'Preto', 'G', 5), v('B-G', 'Branco', 'G', 5), v('M-G', 'Marrom', 'G', 5),
    ],
  },
  isLoading: false, isError: false,
};
vi.mock('@/hooks/useFamilia', () => ({ useFamilia: () => familia }));
const modulos = { data: ['kit_variacao'] as string[] };
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => modulos }));
vi.mock('@/components/kit-variacao/simulador-kit', () => ({
  SimuladorKit: ({ onPodeSeguir }: { onPodeSeguir?: (p: boolean) => void }) => {
    onPodeSeguir?.(true);
    return <div>simulador</div>;
  },
}));
vi.mock('@/lib/kit-variacao-edge', () => ({
  criarKitVariacaoEdge: vi.fn(async () => ({ ok: true, kit_id: 'K1' })),
  enviarFotoKit: vi.fn(async (pasta: string, rotulo: string) => `ORG/${pasta}/${rotulo}.jpg`),
  gerarTextoKitEdge: vi.fn(async () => ({ ok: true, titulo: 'Kit 2 Blusas Canelada', descricao: 'Kit com 2 peças.', previa_id: 'PV1' })),
  gerarFotoKitEdge: vi.fn(async (p: { requestId: string }) => ({ ok: true, path: `ORG/kit-variacao-ia/${p.requestId}.png`, url: `https://x/${p.requestId}.png` })),
}));
import { criarKitVariacaoEdge, enviarFotoKit, gerarFotoKitEdge } from '@/lib/kit-variacao-edge';

function abrir(isAdmin = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DialogCriarKitVariacao familiaBaseId="FAM" open onOpenChange={() => {}} isAdmin={isAdmin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const linhasCombinacao = () => screen.getAllByRole('row').map((r) => r.getAttribute('aria-label')).filter(Boolean);

async function montar(user: ReturnType<typeof userEvent.setup>, cores: string[], qtd: Record<string, string>) {
  for (const c of cores) await user.click(screen.getByRole('checkbox', { name: `Cor ${c}` }));
  for (const [rotulo, n] of Object.entries(qtd)) {
    await user.clear(screen.getByLabelText(`Quantidade ${rotulo}`));
    await user.type(screen.getByLabelText(`Quantidade ${rotulo}`), n);
  }
}

describe('DialogCriarKitVariacao', () => {
  beforeEach(() => { modulos.data = ['kit_variacao']; });

  it('as combinações mudam com as cores marcadas', async () => {
    const user = userEvent.setup();
    abrir();
    await montar(user, ['Preto', 'Branco'], {});
    expect(linhasCombinacao()).toEqual(['Combinação Preto e Branco']);
    await user.click(screen.getByRole('checkbox', { name: 'Cor Marrom' }));
    expect(linhasCombinacao()).toEqual([
      'Combinação Preto e Branco', 'Combinação Preto e Marrom', 'Combinação Branco e Marrom',
    ]);
  });

  it('Próximo bloqueia sem nenhum kit com quantidade', async () => {
    const user = userEvent.setup();
    abrir();
    await montar(user, ['Preto', 'Branco'], {});
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled();
    await montar(user, [], { 'Preto e Branco M': '1' });
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeEnabled();
  });

  it('peça além do saldo fica vermelha e bloqueia', async () => {
    const user = userEvent.setup();
    abrir();
    // Preto M tem 2 peças: 3 kits pedem 3.
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '3' });
    const celula = screen.getByLabelText('Saldo Preto M');
    expect(celula).toHaveTextContent('3 de 2');
    expect(celula).toHaveAttribute('data-excesso', 'true');
    expect(celula.className).toMatch(/text-danger/);
    expect(screen.getByLabelText('Saldo Branco M')).toHaveAttribute('data-excesso', 'false');
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled();
    expect(screen.getByText(/Faltam peças/)).toBeInTheDocument();
  });

  it('sem foto em toda combinação bloqueia em empresa sem IA de imagem', async () => {
    const user = userEvent.setup();
    abrir();
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '1' });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.click(screen.getByRole('button', { name: /Gerar título e descrição/ }));
    await screen.findByDisplayValue('Kit 2 Blusas Canelada');
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled();
    expect(screen.getByText(/Envie a foto de cada combinação/)).toBeInTheDocument();

    const arquivo = new File(['x'], 'pb.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Foto Preto e Branco'), arquivo);
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeEnabled();
  });

  it('sem o módulo imagem_ia não há "Gerar foto"', async () => {
    const user = userEvent.setup();
    abrir();
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '1' });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.queryByRole('button', { name: /Gerar foto/ })).toBeNull();
  });

  it('foto gerada por IA só vale depois de aprovada; a aprovada vai como caminho, sem novo envio', async () => {
    modulos.data = ['kit_variacao', 'imagem_ia'];
    vi.mocked(gerarFotoKitEdge).mockClear();
    vi.mocked(enviarFotoKit).mockClear();
    vi.mocked(criarKitVariacaoEdge).mockClear();
    const user = userEvent.setup();
    abrir();
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '1' });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.click(screen.getByRole('button', { name: /Gerar título e descrição/ }));
    await screen.findByDisplayValue('Kit 2 Blusas Canelada');

    await user.click(screen.getByRole('button', { name: 'Gerar foto Preto e Branco' }));
    await screen.findByRole('img', { name: 'Foto gerada Preto e Branco' });
    expect(vi.mocked(gerarFotoKitEdge).mock.calls[0][0]).toMatchObject({ familiaBaseId: 'FAM', cores: ['Preto', 'Branco'] });
    // Gerada, mas não aprovada: não publica.
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled();

    // Gerar outra usa outro request_id.
    await user.click(screen.getByRole('button', { name: 'Gerar outra Preto e Branco' }));
    await screen.findByRole('img', { name: 'Foto gerada Preto e Branco' });
    const [a, b] = vi.mocked(gerarFotoKitEdge).mock.calls.map((c) => c[0].requestId);
    expect(a).not.toBe(b);

    // Prévia ainda não carregou: não dá para aprovar.
    expect(screen.getByRole('button', { name: 'Usar foto gerada Preto e Branco' })).toBeDisabled();
    fireEvent.load(screen.getByRole('img', { name: 'Foto gerada Preto e Branco' }));
    await user.click(screen.getByRole('button', { name: 'Usar foto gerada Preto e Branco' }));
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.click(screen.getByRole('button', { name: 'Criar kit' }));
    await vi.waitFor(() => expect(criarKitVariacaoEdge).toHaveBeenCalled());
    expect(vi.mocked(criarKitVariacaoEdge).mock.calls[0][0].fotos).toEqual({ 'Preto e Branco': `ORG/kit-variacao-ia/${b}.png` });
    expect(enviarFotoKit).not.toHaveBeenCalled();
  });

  it('falha incerta (sem motivo) repete o mesmo pedido: recupera a geração existente em vez de gerar outra', async () => {
    modulos.data = ['kit_variacao', 'imagem_ia'];
    vi.mocked(gerarFotoKitEdge).mockClear();
    vi.mocked(gerarFotoKitEdge).mockResolvedValueOnce({ ok: false, mensagem: 'Falha ao registrar a geração.' });
    const user = userEvent.setup();
    abrir();
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '1' });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    const botao = () => screen.getByRole('button', { name: 'Gerar foto Preto e Branco' });
    await user.click(botao());
    await vi.waitFor(() => expect(botao()).toBeEnabled());
    await user.click(botao());
    await screen.findByRole('img', { name: 'Foto gerada Preto e Branco' });
    const [a, b] = vi.mocked(gerarFotoKitEdge).mock.calls.map((x) => x[0].requestId);
    expect(b).toBe(a);
  });

  it('prévia sem URL não deixa aprovar; "Recarregar prévia" usa o mesmo pedido, sem gerar outra', async () => {
    modulos.data = ['kit_variacao', 'imagem_ia'];
    vi.mocked(gerarFotoKitEdge).mockClear();
    vi.mocked(gerarFotoKitEdge).mockResolvedValueOnce({ ok: true, path: 'ORG/kit-variacao-ia/x.png', url: null });
    const user = userEvent.setup();
    abrir();
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '1' });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.click(screen.getByRole('button', { name: 'Gerar foto Preto e Branco' }));
    await screen.findByRole('button', { name: 'Recarregar prévia Preto e Branco' });
    expect(screen.getByRole('button', { name: 'Usar foto gerada Preto e Branco' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Recarregar prévia Preto e Branco' }));
    const img = await screen.findByRole('img', { name: 'Foto gerada Preto e Branco' });
    fireEvent.load(img);
    expect(screen.getByRole('button', { name: 'Usar foto gerada Preto e Branco' })).toBeEnabled();
    const [a, b] = vi.mocked(gerarFotoKitEdge).mock.calls.map((x) => x[0].requestId);
    expect(b).toBe(a);
  });

  it('falha definitiva da geração libera um pedido novo; falha de rede repete o mesmo', async () => {
    modulos.data = ['kit_variacao', 'imagem_ia'];
    vi.mocked(gerarFotoKitEdge).mockClear();
    vi.mocked(gerarFotoKitEdge)
      .mockResolvedValueOnce({ ok: false, motivo: 'rede', mensagem: 'Failed to fetch' })
      .mockResolvedValueOnce({ ok: false, motivo: 'imagem_inadequada', mensagem: 'Gere outra.' });
    const user = userEvent.setup();
    abrir();
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '1' });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    const botao = () => screen.getByRole('button', { name: 'Gerar foto Preto e Branco' });
    await user.click(botao());
    await vi.waitFor(() => expect(botao()).toBeEnabled());
    await user.click(botao());
    await vi.waitFor(() => expect(botao()).toBeEnabled());
    await user.click(botao());
    await screen.findByRole('img', { name: 'Foto gerada Preto e Branco' });
    const [a, b, c] = vi.mocked(gerarFotoKitEdge).mock.calls.map((x) => x[0].requestId);
    expect(b).toBe(a);
    expect(c).not.toBe(b);
  });

  it('a explicação da reposição usa a meta digitada', async () => {
    const user = userEvent.setup();
    abrir();
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '1' });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.click(screen.getByRole('checkbox', { name: /Vender só em kit/ }));
    await user.clear(screen.getByLabelText('Meta por combinação e tamanho'));
    await user.type(screen.getByLabelText('Meta por combinação e tamanho'), '5');
    const explicacao = screen.getByLabelText('Como funciona a reposição');
    expect(explicacao).toHaveTextContent('meta de 5');
    expect(within(explicacao).getByText(/o saldo foi para 4/)).toHaveTextContent('Preto e Branco M');
    expect(explicacao).toHaveTextContent('volta a 5');
  });

  it('"Vender só em kit" não aparece para quem não é admin', async () => {
    const user = userEvent.setup();
    abrir(false);
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '1' });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.queryByRole('checkbox', { name: /Vender só em kit/ })).toBeNull();
  });

  it('mudar as cores descarta o texto gerado (a prévia é de outra combinação)', async () => {
    const user = userEvent.setup();
    abrir();
    await montar(user, ['Preto', 'Branco'], { 'Preto e Branco M': '1' });
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.click(screen.getByRole('button', { name: /Gerar título e descrição/ }));
    await screen.findByDisplayValue('Kit 2 Blusas Canelada');
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await user.click(screen.getByRole('checkbox', { name: 'Cor Marrom' }));
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.queryByDisplayValue('Kit 2 Blusas Canelada')).toBeNull();
  });
});
