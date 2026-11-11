// ADR-0202: atributo que a IA tirou da foto aparece na Revisão marcado "confira", com o valor atual.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AtributosPorFoto } from '../atributos-por-foto';
import type { Familia } from '@/lib/tipos-dominio';

vi.mock('@/hooks/useFamiliaMutations', () => ({
  useSalvarAtributo: () => ({ mutateAsync: vi.fn() }),
}));

const familia = {
  id: 'f1', loteId: 'l1',
  atributosMl: [{ id: 'SLEEVE_TYPE', value_id: '11' }],
  atributosPorFoto: [{ id: 'SLEEVE_TYPE', nome: 'Tipo de manga', valores: [{ id: '10', nome: 'Curta' }, { id: '11', nome: 'Sem mangas' }] }],
} as unknown as Familia;

afterEach(cleanup);

describe('AtributosPorFoto', () => {
  it('mostra o aviso, o atributo e o valor escolhido pela foto', () => {
    render(<AtributosPorFoto familia={familia} />);
    expect(screen.getByText(/Pela foto \(IA\) — confira/)).toBeInTheDocument();
    expect(screen.getByText('Tipo de manga')).toBeInTheDocument();
    expect(screen.getByText('Sem mangas')).toBeInTheDocument();
  });

  it('sem atributo pela foto → não renderiza nada', () => {
    const { container } = render(<AtributosPorFoto familia={{ ...familia, atributosPorFoto: undefined }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
