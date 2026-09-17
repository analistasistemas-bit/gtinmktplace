import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FamiliaExpanded } from '@/components/familia-expanded';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

vi.mock('@/lib/upload-imagens', async (orig) => ({
  ...(await orig<typeof import('@/lib/upload-imagens')>()),
  removerCapaFamilia: vi.fn(),
}));
import { removerCapaFamilia } from '@/lib/upload-imagens';

// Mesmo helper e fixtures de tests/components/familia-expanded.test.tsx.
function renderWithClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
      </MemoryRouter>,
    ),
  };
}

function cor(over: Partial<Variacao>): Variacao {
  return {
    codigo: '02719606', cor: 'Cereja 2018', corHex: '#a00', corOrigem: 'descricao',
    corEditadaPeloOperador: false, preco: 1.7, precoPublicacao: 1.7, estoque: 112,
    gtin: '7909857002676', fotoPath: undefined, excluidaDaPublicacao: false,
    mlVariationId: null, estoqueAnterior: null,
    ...over,
  };
}
function fam(over: Partial<Familia>): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00445932', titulo: 'FITAS PROGRESSO N.1', descricao: 'd',
    operacao: 'CREATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '',
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null,
    analiseMercado: null, tipoAviamento: 'fita', categoriaMlId: 'MLB255054',
    precoMin: 1.7, precoMax: 1.7, precoAbaixo20pc: false, capaStoragePath: null,
    variacoes: [cor({})], status: 'pronto', tokensInput: null, tokensOutput: null,
    custoCentavos: null, tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false, variacoesSemCor: 0,
    mlPermalink: null, mlItemId: null, erroMensagem: null, mudancaEstrutural: null,
    concorrenciaCategoriaId: null,
    ...over,
  };
}

// Sem estado de pendência, o botão continuava clicável durante a remoção e disparava duas vezes.
describe('FamiliaExpanded — remover capa', () => {
  it('clique duplo remove uma única vez e o modal mostra o progresso', async () => {
    vi.mocked(removerCapaFamilia).mockImplementation(() => new Promise<void>(() => {}));
    // capaStoragePath precisa vir preenchido: o AlertDialog de remover nem renderiza sem ele.
    const familia = fam({ capaStoragePath: 'org/familia/capa.jpg' });
    renderWithClient(<FamiliaExpanded familia={familia} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^Remover$/ }));
    // O gatilho e o botão de confirmar têm o mesmo rótulo ("Remover") — escopar ao diálogo
    // aberto evita pegar o gatilho por engano.
    const dialog = screen.getByRole('alertdialog');
    const confirmar = within(dialog).getByRole('button', { name: /^Remover$/ });
    await user.click(confirmar);
    await user.click(confirmar);

    expect(removerCapaFamilia).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(dialog).getByRole('progressbar')).toBeInTheDocument());
  });
});
