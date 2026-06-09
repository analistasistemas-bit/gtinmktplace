import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FamiliaExpanded } from '@/components/familia-expanded';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

function renderWithClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>),
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
      <QueryClientProvider client={qc}>
        <FamiliaExpanded familia={comFoto} />
      </QueryClientProvider>
    );
    expect(screen.queryByText(/sem foto/i)).not.toBeInTheDocument();
  });
});
