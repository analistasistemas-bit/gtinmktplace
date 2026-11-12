import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FamiliaExpanded } from '@/components/familia-expanded';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

const setVariacaoExcluidaMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/publicar', () => ({
  setVariacaoExcluida: (...args: unknown[]) => setVariacaoExcluidaMock(...args),
}));

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

describe('FamiliaExpanded — foto da variação reflete o refetch', () => {
  it('ao chegar fotoPath nova na prop (após upload), some o "sem foto"', () => {
    const semFoto = fam({ variacoes: [cor({ fotoPath: undefined })] });
    const { qc, rerender } = renderWithClient(<FamiliaExpanded familia={semFoto} />);
    expect(screen.getByText(/sem foto/i)).toBeInTheDocument();

    // Simula o que o refetch faz: mesma família, agora com a foto gravada no banco.
    const comFoto = fam({ variacoes: [cor({ fotoPath: 'user/02719606.jpeg' })] });
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <FamiliaExpanded familia={comFoto} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText(/sem foto/i)).not.toBeInTheDocument();
  });
});

// Incidente 12/11/2026 (produto 92710170): no lote do "Adicionar variação" a Revisão deixava desmarcar cor já
// publicada, e a saga pausou as 7 desmarcadas. O worker recusa; a tela nem oferece.
describe('FamiliaExpanded — Adicionar variação não deixa desmarcar cor publicada', () => {
  const familia = fam({
    operacao: 'UPDATE', mlItemId: 'MLB1',
    variacoes: [
      cor({ id: 'v-a', codigo: 'A', cor: 'Azul', fotoPath: 'u/a.jpg', jaCasadaUP: true }),
      cor({ id: 'v-b', codigo: 'B', cor: 'Bege', fotoPath: 'u/b.jpg', mlVariationId: 'm2' }),
      cor({ id: 'v-c', codigo: 'C', cor: 'Coral', fotoPath: 'u/c.jpg', jaCasadaUP: true, excluidaDaPublicacao: true }),
      cor({ id: 'v-n', codigo: 'N', cor: 'Nova', fotoPath: 'u/n.jpg' }),
    ],
  });
  const caixa = (nome: string) => screen.getByRole('checkbox', { name: `Incluir cor ${nome} na publicação` });

  it('cor publicada e marcada fica travada, com o aviso; clicar não grava', () => {
    setVariacaoExcluidaMock.mockClear();
    renderWithClient(<FamiliaExpanded familia={familia} adicionarVariacao />);
    expect(screen.getByText('Em Adicionar variação, todas as cores seguem.')).toBeInTheDocument();
    for (const nome of ['Azul', 'Bege']) {
      expect(caixa(nome)).toBeDisabled();
      expect(caixa(nome)).toBeChecked();
      fireEvent.click(caixa(nome));
    }
    expect(setVariacaoExcluidaMock).not.toHaveBeenCalled();
  });

  it('cor nova segue desmarcável, e a publicada que já veio desmarcada pode ser marcada de volta', async () => {
    setVariacaoExcluidaMock.mockClear();
    renderWithClient(<FamiliaExpanded familia={familia} adicionarVariacao />);
    expect(caixa('Nova')).toBeEnabled();
    expect(caixa('Coral')).toBeEnabled();
    fireEvent.click(caixa('Coral'));
    await waitFor(() => expect(setVariacaoExcluidaMock).toHaveBeenCalledWith('v-c', false));
    // Marcada de volta, trava como as demais.
    expect(caixa('Coral')).toBeDisabled();
  });

  it('UPDATE de planilha (sem a prop): nada muda, a cor publicada segue desmarcável e sem aviso', async () => {
    setVariacaoExcluidaMock.mockClear();
    renderWithClient(<FamiliaExpanded familia={familia} />);
    expect(screen.queryByText(/todas as cores seguem/)).not.toBeInTheDocument();
    expect(caixa('Azul')).toBeEnabled();
    fireEvent.click(caixa('Azul'));
    await waitFor(() => expect(setVariacaoExcluidaMock).toHaveBeenCalledWith('v-a', true));
  });
});

describe('FamiliaExpanded — prompt "aplicar às demais?" (ADR-0078 F2b, achado do review)', () => {
  it('UPDATE já publicado, "Não" cruzaria uma faixa no ar → avisa que vai exigir dividir o anúncio', async () => {
    const familia = fam({
      operacao: 'UPDATE',
      mlItemId: 'MLB6900892156',
      variacoes: [
        cor({ id: 'v-a', codigo: 'A', cor: 'Azul', mlVariationId: 'm1', precoPublicadoMl: 10, preco: 10, precoPublicacao: 10 }),
        cor({ id: 'v-b', codigo: 'B', cor: 'Verde', mlVariationId: 'm2', precoPublicadoMl: 10, preco: 20, precoPublicacao: 20 }),
      ],
    });
    renderWithClient(<FamiliaExpanded familia={familia} />);

    const input = screen.getByDisplayValue('10');
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.blur(input);

    await screen.findByText(/Aplicar o novo preço às demais variações\?/i);
    expect(screen.getByText(/EXIGIR dividir um anúncio já publicado/i)).toBeInTheDocument();
    expect(screen.getByText(/falhar de propósito/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Não, dividir anúncio/i })).toBeInTheDocument();
  });

  it('família nova (CREATE) mantém a copy neutra de "anúncios separados"', async () => {
    const familia = fam({
      operacao: 'CREATE',
      variacoes: [
        cor({ id: 'v-a', codigo: 'A', cor: 'Azul', preco: 10, precoPublicacao: 10 }),
        cor({ id: 'v-b', codigo: 'B', cor: 'Verde', preco: 20, precoPublicacao: 20 }),
      ],
    });
    renderWithClient(<FamiliaExpanded familia={familia} />);

    const input = screen.getByDisplayValue('10');
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.blur(input);

    await screen.findByText(/Aplicar o novo preço às demais variações\?/i);
    expect(screen.getByText(/anúncios separados no Mercado Livre/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Não, só esta cor/i })).toBeInTheDocument();
  });
});

describe('FamiliaExpanded — incluir cor nova (UPDATE) reflete o clique', () => {
  it('marcar uma cor nova excluída persiste E deixa o checkbox marcado na hora', async () => {
    setVariacaoExcluidaMock.mockClear();
    // Cor nova de um anúncio já publicado (UPDATE), entra excluída por padrão.
    const novaExcluida = fam({
      operacao: 'UPDATE',
      mlItemId: 'MLB6900892156',
      variacoes: [
        cor({ id: 'v-nova', codigo: '02719700', cor: 'Verde Neon', fotoPath: 'user/02719700.jpeg', excluidaDaPublicacao: true, mlVariationId: null }),
      ],
    });
    renderWithClient(<FamiliaExpanded familia={novaExcluida} />);

    const cb = screen.getByRole('checkbox', { name: /Incluir cor Verde Neon na publicação/i });
    expect(cb).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(cb);

    // Persistiu a inclusão (excluida=false) no banco...
    await waitFor(() => expect(setVariacaoExcluidaMock).toHaveBeenCalledWith('v-nova', false));
    // ...e o checkbox reflete o clique imediatamente (sem depender de um refetch
    // que não re-sincroniza este campo).
    await waitFor(() => expect(cb).toHaveAttribute('aria-checked', 'true'));
  });
});
