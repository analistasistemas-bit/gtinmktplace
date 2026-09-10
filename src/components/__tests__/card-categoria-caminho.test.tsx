// Caminho completo da categoria no card da Revisão (achado do Diego, 10/09/2026 — mesma queixa
// que motivou a mudança no diálogo de kit): "Leite", "Leite" e "Leite em Pó" na mesma lista de
// resultados são indistinguíveis sem o ramo. Trava os dois pontos: a categoria já definida e
// cada candidato da busca. Degradação (caminho não chega) mantém o nome sozinho, como antes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardCategoria } from '../card-categoria';
import type { Familia } from '@/lib/tipos-dominio';

vi.mock('@/hooks/useFamiliaMutations', () => ({
  useDefinirCategoriaLivre: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

const buscarCategoriaMLMock = vi.fn(async () => ({
  candidatos: [{ categoriaId: 'MLB999', categoriaNome: 'Leite em Pó', domainName: '' }],
  sugestaoConcorrente: null,
}));
vi.mock('@/lib/queries', () => ({
  buscarCategoriaML: (...args: unknown[]) => buscarCategoriaMLMock(...(args as [])),
}));

const caminhoCategoriaMLMock = vi.fn(async (_id: string) => [] as string[]);
vi.mock('@/lib/caminho-categoria-ml', () => ({
  caminhoCategoriaML: (id: string) => caminhoCategoriaMLMock(id),
}));

const base = {
  id: 'f1', loteId: 'l1',
  categoriaMlId: 'MLB1246', categoriaNome: 'Leite em Pó',
  tipoOrigem: 'preditor', tipoAviamento: null, atributosFaltantes: null,
  concorrenciaCategoriaId: null,
  catalogoCategoriaSugeridaId: null,
  catalogoCategoriaSugeridaNome: null,
  catalogoCategoriaSugeridaVendedores: null,
} as unknown as Familia;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CardCategoria — caminho completo', () => {
  it('mostra o ramo acima do nome da categoria já definida', async () => {
    caminhoCategoriaMLMock.mockResolvedValue(['Alimentos e Bebidas', 'Mercearia', 'Leite em Pó']);
    render(<CardCategoria familia={base} />);

    await waitFor(() => expect(screen.getByText(/Alimentos e Bebidas › Mercearia/)).toBeInTheDocument());
    expect(screen.getByText('Leite em Pó')).toBeInTheDocument();
  });

  it('mostra o ramo em cada candidato da busca', async () => {
    caminhoCategoriaMLMock.mockImplementation(async (id: string) => (
      id === 'MLB999' ? ['Alimentos e Bebidas', 'Leite', 'Leite em Pó'] : []
    ));
    render(<CardCategoria familia={base} />);

    await userEvent.click(screen.getByText('Trocar categoria'));
    await userEvent.type(screen.getByPlaceholderText(/Buscar categoria/), 'leite');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/Alimentos e Bebidas › Leite ›/)).toBeInTheDocument());
    expect(screen.getByText('(MLB999)')).toBeInTheDocument();
  });

  it('caminho indisponível (rede falhou) mantém só o nome — nunca some a categoria', async () => {
    caminhoCategoriaMLMock.mockResolvedValue([]);
    render(<CardCategoria familia={base} />);

    expect(screen.getByText('Leite em Pó')).toBeInTheDocument();
    expect(screen.queryByText(/›/)).not.toBeInTheDocument();
  });
});
