// Card "Sugestão (catálogo)" (spec 2026-08-22). O que estes testes travam:
//  - o card renderiza DIRETO da row (sem foco, sem rede — diferente do card do concorrente);
//  - clicar aplica via definirCategoriaLivre com id/nome persistidos;
//  - sugestão igual à categoria atual não renderiza; concorrente idêntico não duplica card.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardCategoria } from '../card-categoria';
import { buscarCategoriaML } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

const mutate = vi.fn();
vi.mock('@/hooks/useFamiliaMutations', () => ({
  useDefinirCategoriaLivre: () => ({ mutate, isPending: false, variables: undefined }),
}));
vi.mock('@/lib/queries', () => ({
  buscarCategoriaML: vi.fn(async () => ({ candidatos: [], sugestaoConcorrente: null })),
}));

const base = {
  id: 'f1', loteId: 'l1',
  categoriaMlId: 'MLB277750', categoriaNome: 'Cremes, Pomadas e Óleos',
  tipoOrigem: 'preditor', tipoAviamento: null, atributosFaltantes: null,
  concorrenciaCategoriaId: null,
  catalogoCategoriaSugeridaId: 'MLB1262',
  catalogoCategoriaSugeridaNome: 'Cuidado do Corpo',
  catalogoCategoriaSugeridaVendedores: 7,
} as unknown as Familia;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CardCategoria — sugestão de catálogo', () => {
  it('renderiza o card direto da row, sem foco nem rede', () => {
    render(<CardCategoria familia={base} />);
    expect(screen.getByRole('button', { name: /Sugestão \(catálogo\)/ })).toBeInTheDocument();
    expect(screen.getByText(/7 vendedores competindo/)).toBeInTheDocument();
    expect(buscarCategoriaML).not.toHaveBeenCalled();
  });

  it('clicar aplica via definirCategoriaLivre com id/nome da sugestão', async () => {
    render(<CardCategoria familia={base} />);
    await userEvent.click(screen.getByRole('button', { name: /Sugestão \(catálogo\)/ }));
    expect(mutate).toHaveBeenCalledWith(
      { familiaId: 'f1', categoriaMlId: 'MLB1262', categoriaNome: 'Cuidado do Corpo' },
      expect.anything(),
    );
  });

  it('não renderiza quando a sugestão é a própria categoria atual', () => {
    render(<CardCategoria familia={{ ...base, categoriaMlId: 'MLB1262' } as Familia} />);
    expect(screen.queryByRole('button', { name: /Sugestão \(catálogo\)/ })).not.toBeInTheDocument();
  });

  it('concorrente idêntico ao catálogo não carrega card duplicado', async () => {
    render(<CardCategoria familia={{ ...base, concorrenciaCategoriaId: 'MLB1262' } as Familia} />);
    await userEvent.click(screen.getByText('Trocar categoria'));
    await userEvent.click(screen.getByPlaceholderText(/Buscar categoria/));
    expect(buscarCategoriaML).not.toHaveBeenCalled(); // dedupe: nem chega a buscar o concorrente
  });
});
