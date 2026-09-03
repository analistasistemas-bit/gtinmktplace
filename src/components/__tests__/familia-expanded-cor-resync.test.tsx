import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

// Round 1 do fix-cor-cadastro-manual: a chave de resync do estado local de variacoes
// (fotosKey) foi ampliada para incluir corOrigem — corOrigem só muda por confirmação do
// servidor, então parecia seguro. A revisão achou o problema: corOrigem também muda como
// EFEITO COLATERAL de o próprio operador editar a cor (debounce 600ms → save → invalidate
// → refetch → corOrigem null→'manual'). Um replace total (setVariacoes(familia.variacoes))
// nesse gatilho reverte o texto que o operador está digitando na mesma linha. A correção foi
// separar num segundo efeito que faz MERGE — só corOrigem é atualizado por código, o resto do
// estado local (inclusive `cor` em edição) sobrevive. Este teste prova o merge: dispara
// exatamente o gatilho (corOrigem null→'manual' via rerender) com uma edição local pendente
// na própria cor, e falharia com o replace total da tentativa anterior.

vi.mock('@/components/variacao-card', () => ({
  VariacaoCard: ({ variacao, onMudarCor }: { variacao: Variacao; onMudarCor: (codigo: string, v: string) => void }) => (
    <div>
      <input aria-label={`cor-${variacao.codigo}`} value={variacao.cor} onChange={(e) => onMudarCor(variacao.codigo, e.target.value)} />
      <span data-testid={`origem-${variacao.codigo}`}>{variacao.corOrigem ?? 'nula'}</span>
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
  useUpdateFamiliaTitulo: () => ({ mutateAsync: vi.fn() }),
  useUpdateFamiliaDescricao: () => ({ mutateAsync: vi.fn() }),
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
    preco: 10, precoPublicacao: 10, precoPublicadoMl: null, estoque: 5, gtin: null,
    excluidaDaPublicacao: false, mlVariationId: null, estoqueAnterior: null, custo: null,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null,
    exibirComDesconto: null, descontoPct: null, atacado: null,
    ...over,
  };
}

function familia(variacoes: Variacao[]): Familia {
  return {
    id: 'fam-1', loteId: 'lote-1', codigoPai: '099001', titulo: 'Produto', descricao: 'Desc',
    operacao: 'CREATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '', precoReancoradoLider: false,
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null, analiseMercado: null,
    tipoAviamento: null, categoriaMlId: null, formatoPublicacaoMl: null, categoriaNome: null,
    tipoOrigem: null, concorrenciaCategoriaId: null, origem: 'nacional', atributosFaltantes: null,
    catalogoCategoriaSugeridaId: null, catalogoCategoriaSugeridaNome: null, catalogoCategoriaSugeridaVendedores: null,
    atributosMl: [], precoMin: 10, precoMax: 10, precoAbaixo20pc: false, capaStoragePath: null,
    capa2StoragePath: null, capa3StoragePath: null, variacaoPrincipalCodigo: null, variacoes,
    status: 'pendente', tokensInput: null, tokensOutput: null, custoCentavos: null,
    tituloEditadoPeloOperador: false, descricaoEditadaPeloOperador: false, variacoesSemCor: 0,
    mlPermalink: null, mlItemId: null, anuncios: [], mudancaEstrutural: null, erroMensagem: null,
    exibirComDesconto: false, descontoPct: null, atacado: null, atacadoStatus: null, atacadoErro: null,
  };
}

describe('FamiliaExpanded — resync de corOrigem preserva edição local em andamento', () => {
  it('corOrigem null→manual atualiza o badge sem reverter a cor que o operador está digitando', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const f1 = familia([variacao({ cor: '', corOrigem: null })]);
    const { rerender } = render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <FamiliaExpanded familia={f1} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // Operador digita "Invisível" — ainda não salvou (debounce pendente).
    fireEvent.change(screen.getByLabelText('cor-V1'), { target: { value: 'Invisível' } });
    expect(screen.getByLabelText('cor-V1')).toHaveValue('Invisível');
    expect(screen.getByTestId('origem-V1')).toHaveTextContent('nula');

    // Servidor confirma: corOrigem vira 'manual'. O `cor` que o servidor devolve é o
    // valor salvo ANTES do operador terminar de digitar ("Invis", debounce disparou no
    // meio da digitação) — deliberadamente diferente do que está no input agora
    // ("Invisível"), para o teste pegar um replace que reverteria a digitação.
    const f2 = familia([variacao({ cor: 'Invis', corOrigem: 'manual' })]);
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <FamiliaExpanded familia={f2} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // O que estaria na tela com um replace total (bug do round 1): reverteria para
    // familia.variacoes do servidor. O merge preserva a digitação em andamento.
    expect(screen.getByLabelText('cor-V1')).toHaveValue('Invisível');
    expect(screen.getByTestId('origem-V1')).toHaveTextContent('manual');
  });
});
