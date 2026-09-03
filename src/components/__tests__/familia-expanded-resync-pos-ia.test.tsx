import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

// Lote manual #21 (2026-08-22): o cadastro pela Viabilidade navega para a Revisão ANTES de
// process-familia terminar (~60-90s). O estado local de FamiliaExpanded nascia do snapshot
// pré-IA e nunca ressincronizava título/descrição/preço de publicação:
//  1. a tela mostrava nome/descrição do catálogo ML e "sem preço" para sempre (até reload);
//  2. um focus+blur na descrição salvava o snapshot velho POR CIMA do texto da IA e marcava
//     descricao_editada_pelo_operador — destruição silenciosa e permanente da copy.
// O fix ressincroniza campo não-sujo quando o servidor muda e só salva no blur campo que o
// operador realmente digitou (dirty por onChange).

const updateTituloSpy = vi.fn().mockResolvedValue(undefined);
const updateDescricaoSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('@/components/variacao-card', () => ({
  VariacaoCard: ({ variacao, onMudarPreco }: { variacao: Variacao; onMudarPreco: (codigo: string, v: number) => void }) => (
    <div>
      <input
        aria-label={`preco-${variacao.codigo}`}
        value={variacao.precoPublicacao ?? ''}
        onChange={(e) => onMudarPreco(variacao.codigo, Number(e.target.value))}
      />
    </div>
  ),
}));
vi.mock('@/components/painel-analise', () => ({ PainelAnalise: () => null }));
vi.mock('@/components/card-categoria', () => ({ CardCategoria: () => null }));
vi.mock('@/components/foto-capa-familia', () => ({ FotoCapaFamilia: () => null }));
vi.mock('@/hooks/useFamiliaMutations', () => ({
  useUpdateVariacaoPreco: () => ({ mutateAsync: vi.fn() }),
  useUpdateVariacaoCor: () => ({ mutateAsync: vi.fn() }),
  useUpdateVariacaoGtin: () => ({ mutateAsync: vi.fn() }),
  useUpdateFamiliaTitulo: () => ({ mutateAsync: updateTituloSpy }),
  useUpdateFamiliaDescricao: () => ({ mutateAsync: updateDescricaoSpy }),
  useRegenerarCopy: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateVariacaoPrincipal: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useImageUrl', () => ({
  useImageUrl: () => ({ data: undefined }),
  invalidarImagem: vi.fn(),
}));
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => ({ data: undefined }) }));
vi.mock('@/lib/upload-imagens', () => ({
  subirCapaFamilia: vi.fn(), removerCapaFamilia: vi.fn(),
  subirCapa2Familia: vi.fn(), removerCapa2Familia: vi.fn(),
  subirCapa3Familia: vi.fn(), removerCapa3Familia: vi.fn(),
}));
vi.mock('@/lib/publicar', () => ({ setVariacaoExcluida: vi.fn() }));

import { FamiliaExpanded } from '../familia-expanded';

function variacao(over: Partial<Variacao> = {}): Variacao {
  return {
    codigo: 'V1', cor: '', corHex: '#fff', corOrigem: null, corEditadaPeloOperador: false,
    preco: 59.9, precoPublicacao: null, precoPublicadoMl: null, estoque: 5, gtin: null,
    excluidaDaPublicacao: false, mlVariationId: null, estoqueAnterior: null, custo: null,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null,
    exibirComDesconto: null, descontoPct: null, atacado: null,
    ...over,
  };
}

function familia(over: Partial<Familia> = {}): Familia {
  return {
    id: 'fam-1', loteId: 'lote-1', codigoPai: '099001', titulo: 'Nome cru do catálogo',
    descricao: 'Descrição verbatim do catálogo ML',
    operacao: 'CREATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '', precoReancoradoLider: false,
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null, analiseMercado: null,
    tipoAviamento: null, categoriaMlId: null, formatoPublicacaoMl: null, categoriaNome: null,
    tipoOrigem: null, concorrenciaCategoriaId: null, origem: 'nacional', atributosFaltantes: null,
    catalogoCategoriaSugeridaId: null, catalogoCategoriaSugeridaNome: null, catalogoCategoriaSugeridaVendedores: null,
    atributosMl: [], precoMin: 10, precoMax: 10, precoAbaixo20pc: false, capaStoragePath: null,
    capa2StoragePath: null, capa3StoragePath: null, variacaoPrincipalCodigo: null,
    variacoes: [variacao()],
    status: 'processando', tokensInput: null, tokensOutput: null, custoCentavos: null,
    tituloEditadoPeloOperador: false, descricaoEditadaPeloOperador: false, variacoesSemCor: 0,
    mlPermalink: null, mlItemId: null, anuncios: [], mudancaEstrutural: null, erroMensagem: null,
    exibirComDesconto: false, descontoPct: null, atacado: null, atacadoStatus: null, atacadoErro: null,
    ...over,
  };
}

function renderCom(qc: QueryClient, f: Familia) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <FamiliaExpanded familia={f} />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const posIA = () => familia({
  status: 'pronto',
  titulo: 'Título reescrito pela IA',
  descricao: '🧵 DESCRIÇÃO GERADA PELA IA',
  variacoes: [variacao({ precoPublicacao: 73.2 })],
});

describe('FamiliaExpanded — resync pós-IA (lote manual #21)', () => {
  beforeEach(() => {
    updateTituloSpy.mockClear();
    updateDescricaoSpy.mockClear();
  });

  it('título, descrição e preço de publicação ressincronizam quando process-familia termina', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(renderCom(qc, familia()));

    expect(screen.getByLabelText('DESCRIÇÃO')).toHaveValue('Descrição verbatim do catálogo ML');
    expect(screen.getByLabelText('preco-V1')).toHaveValue('');

    rerender(renderCom(qc, posIA()));

    expect(screen.getByLabelText('TÍTULO')).toHaveValue('Título reescrito pela IA');
    expect(screen.getByLabelText('DESCRIÇÃO')).toHaveValue('🧵 DESCRIÇÃO GERADA PELA IA');
    expect(screen.getByLabelText('preco-V1')).toHaveValue('73.2');
  });

  it('blur sem digitação não salva nada — não destrói a copy da IA', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(renderCom(qc, familia()));
    rerender(renderCom(qc, posIA()));

    fireEvent.blur(screen.getByLabelText('DESCRIÇÃO'));
    fireEvent.blur(screen.getByLabelText('TÍTULO'));

    expect(updateDescricaoSpy).not.toHaveBeenCalled();
    expect(updateTituloSpy).not.toHaveBeenCalled();
  });

  it('edição em andamento sobrevive ao resync e o blur salva o texto digitado', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(renderCom(qc, familia()));

    fireEvent.change(screen.getByLabelText('DESCRIÇÃO'), { target: { value: 'Texto do operador' } });
    fireEvent.change(screen.getByLabelText('preco-V1'), { target: { value: '99.9' } });

    rerender(renderCom(qc, posIA()));

    // Campos sujos preservados; o não-sujo (título) ressincroniza.
    expect(screen.getByLabelText('DESCRIÇÃO')).toHaveValue('Texto do operador');
    expect(screen.getByLabelText('preco-V1')).toHaveValue('99.9');
    expect(screen.getByLabelText('TÍTULO')).toHaveValue('Título reescrito pela IA');

    fireEvent.blur(screen.getByLabelText('DESCRIÇÃO'));
    expect(updateDescricaoSpy).toHaveBeenCalledWith({ id: 'fam-1', descricao: 'Texto do operador' });
  });
});
