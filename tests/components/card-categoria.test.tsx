import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CardCategoria } from '@/components/card-categoria';
import type { Familia } from '@/lib/tipos-dominio';

// ADR-0054: sugestão do concorrente nunca pode ser aplicada sem clique explícito do operador.
// Mocka buscarCategoriaML (carrega a sugestão) e definirCategoriaLivre (grava a categoria) pra
// travar esse invariante de segurança contra um refactor que mova escolher(sugestao) pra um efeito.
const buscarCategoriaMLMock = vi.fn();
vi.mock('@/lib/queries', () => ({
  buscarCategoriaML: (...args: unknown[]) => buscarCategoriaMLMock(...args),
}));

const definirCategoriaLivreMock = vi.fn();
vi.mock('@/lib/categoria', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/categoria')>();
  return {
    ...actual,
    definirCategoriaLivre: (...args: unknown[]) => definirCategoriaLivreMock(...args),
  };
});

// CardCategoria usa useMutation (seletor manual de categoria) → precisa de QueryClient.
function renderCard(familia: Familia) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CardCategoria familia={familia} />
    </QueryClientProvider>,
  );
}

function familiaBase(over: Partial<Familia> = {}): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00445975',
    titulo: 'FITA CETIM N.3', descricao: '', operacao: 'CREATE',
    estrategiaPreco: 'PROPRIO', estrategiaMotivo: '',
    concorrencia: 'alta', concorrenciaVendedores: 6, concorrenciaPrecoMin: 12.62,
    tipoAviamento: 'fita', categoriaMlId: 'MLB255054',
    categoriaNome: null, tipoOrigem: 'regex', atributosFaltantes: null,
    precoMin: 2.95, precoMax: 2.95, precoAbaixo20pc: false,
    capaStoragePath: null, variacoes: [], status: 'pronto',
    tokensInput: null, tokensOutput: null, custoCentavos: null,
    tituloEditadoPeloOperador: false, descricaoEditadaPeloOperador: false,
    variacoesSemCor: 0, analiseMercado: null,
    concorrenciaCategoriaId: null,
    ...over,
  };
}

describe('CardCategoria', () => {
  it('categoria definida mostra nome amigável + id', () => {
    renderCard(familiaBase());
    expect(screen.getByText(/Fita de Cetim/i)).toBeInTheDocument();
    expect(screen.getByText(/MLB255054/)).toBeInTheDocument();
  });

  it('categoria indefinida (tipo outro / sem id) alerta + oferece busca', () => {
    renderCard(familiaBase({ tipoAviamento: 'outro', categoriaMlId: null }));
    expect(screen.getByText(/categoria indefinida/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/buscar categoria/i)).toBeInTheDocument();
  });

  it('cola: mostra "Bastões de Cola" quando definida', () => {
    renderCard(familiaBase({ tipoAviamento: 'cola', categoriaMlId: 'MLB277319' }));
    expect(screen.getByText(/Bastões de Cola/i)).toBeInTheDocument();
    expect(screen.getByText(/MLB277319/)).toBeInTheDocument();
  });

  it('categoria prevista (preditor): usa categoria_nome + selo "Sugerida por IA" + faltantes', () => {
    renderCard(familiaBase({
      tipoAviamento: 'outro', categoriaMlId: 'MLB189007',
      categoriaNome: 'De Mão', tipoOrigem: 'preditor', atributosFaltantes: ['Voltagem'],
    }));
    expect(screen.getByText(/De Mão/)).toBeInTheDocument();
    expect(screen.getByText(/MLB189007/)).toBeInTheDocument();
    expect(screen.getByText(/Sugerida por IA/i)).toBeInTheDocument();
    expect(screen.getByText(/Faltam:\s*Voltagem/i)).toBeInTheDocument();
  });

  it('ADR-0058: categoria genérica ("Outros") aparece definida, com selo de aviso e busca disponível pra trocar', () => {
    renderCard(familiaBase({
      tipoAviamento: 'outro', categoriaMlId: 'MLB1371',
      categoriaNome: 'Outros', tipoOrigem: 'generico', atributosFaltantes: null,
    }));
    // Definida (não mostra o alerta de bloqueio "categoria indefinida").
    expect(screen.queryByText(/categoria indefinida/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^Outros$/)).toBeInTheDocument();
    expect(screen.getByText(/MLB1371/)).toBeInTheDocument();
    // Selo de aviso distinto do de "Sugerida por IA".
    expect(screen.getByText(/Categoria genérica/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sugerida por IA/i)).not.toBeInTheDocument();
    // Busca continua disponível pra trocar.
    expect(screen.getByPlaceholderText(/buscar categoria/i)).toBeInTheDocument();
  });

  it('override (regex) não mostra selo de sugestão', () => {
    renderCard(familiaBase()); // tipoOrigem 'regex'
    expect(screen.queryByText(/Sugerida por IA/i)).not.toBeInTheDocument();
  });

  it('categoria definida (qualquer origem) sempre oferece "Trocar categoria", mesmo sem ser genérica', () => {
    renderCard(familiaBase()); // tipoOrigem 'regex', categoria MLB255054 definida
    // Busca some por padrão (evita poluir o caso feliz)...
    expect(screen.queryByPlaceholderText(/buscar categoria/i)).not.toBeInTheDocument();
    // ...mas o link pra trocar está sempre alcançável.
    const trocar = screen.getByRole('button', { name: /trocar categoria/i });
    fireEvent.click(trocar);
    // Ao clicar, a busca abre — mesmo pra uma categoria já "correta"/curada.
    expect(screen.getByPlaceholderText(/buscar categoria/i)).toBeInTheDocument();
  });

  it('família vira genérica num refetch ao vivo (sem remount, ex.: reprocessar com a tela aberta) → busca abre sozinha', () => {
    // useState(categoriaGenerica) só roda na 1ª montagem; sem o useEffect de sincronização,
    // a busca ficava fechada até 1 clique extra quando o card já estava montado (mesma key
    // familia.id) e um refetch trazia tipoOrigem='generico' pela 1ª vez.
    const { rerender } = renderCard(familiaBase({ tipoAviamento: 'outro', categoriaMlId: null }));
    expect(screen.getByPlaceholderText(/buscar categoria/i)).toBeInTheDocument(); // indefinida: sempre aberta

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <CardCategoria familia={familiaBase({
          tipoAviamento: 'outro', categoriaMlId: 'MLB1371', categoriaNome: 'Outros', tipoOrigem: 'generico',
        })} />
      </QueryClientProvider>,
    );
    // Definida (não mais bloqueio vermelho) E a busca continua visível, aberta automaticamente.
    expect(screen.queryByText(/categoria indefinida/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/buscar categoria/i)).toBeInTheDocument();
  });

  it('ADR-0054: sugestão do concorrente só aplica com clique explícito, nunca ao carregar', async () => {
    buscarCategoriaMLMock.mockResolvedValue({
      candidatos: [],
      sugestaoConcorrente: { categoriaId: 'MLB999', categoriaNome: 'Categoria X', domainName: '' },
    });

    renderCard(familiaBase({ categoriaMlId: null, concorrenciaCategoriaId: 'MLB999' }));

    fireEvent.focus(screen.getByPlaceholderText(/buscar categoria/i));
    await screen.findByText(/Categoria X/i);

    // Carregar a sugestão NUNCA dispara a mutação sozinho.
    expect(definirCategoriaLivreMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Sugestão \(concorrente\)/i }));

    // Só o clique explícito no card da sugestão dispara a mutação, com os dados certos.
    await waitFor(() => expect(definirCategoriaLivreMock).toHaveBeenCalledWith('f1', 'MLB999', 'Categoria X'));
  });

  it('mostra "Aplicando…" no candidato clicado e desabilita a busca enquanto a mutação está pendente (evita parecer travado, achado do Diego no lote #36)', async () => {
    buscarCategoriaMLMock.mockResolvedValue({
      candidatos: [{ categoriaId: 'MLB271227', categoriaNome: 'Zíperes', domainName: '' }],
      sugestaoConcorrente: null,
    });
    let resolverMutacao: (v: unknown) => void = () => {};
    definirCategoriaLivreMock.mockReturnValue(new Promise((resolve) => { resolverMutacao = resolve; }));

    renderCard(familiaBase({ categoriaMlId: null }));
    const input = screen.getByPlaceholderText(/buscar categoria/i);
    fireEvent.change(input, { target: { value: 'ziper' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(/Zíperes/i);

    fireEvent.click(screen.getByRole('button', { name: /Zíperes/i }));

    expect(await screen.findByText(/Aplicando…/i)).toBeInTheDocument();
    expect(input).toBeDisabled();

    resolverMutacao(undefined);
  });
});
