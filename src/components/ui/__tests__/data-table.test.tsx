import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DataTable, type Column } from '../data-table';

interface Linha { titulo: string; vendidos: number | null }

const colunas: Column<Linha>[] = [
  { key: 'titulo', header: 'Anúncio', cell: (l) => l.titulo, sortValue: (l) => l.titulo },
  { key: 'vendidos', header: 'Vendidos', cell: (l) => l.vendidos ?? '—', sortValue: (l) => l.vendidos },
];

const textoDasLinhas = () => screen.getAllByRole('row').slice(1).map((tr) => tr.textContent);

// A ordem inicial da tabela do Sonar depende deste contrato: `dir: 'desc'` põe o maior primeiro e
// os sem dado no fim — anúncio sem "+N vendidos" não pode subir por ausência de número.
describe('DataTable — defaultSort', () => {
  it('desc: maior primeiro e nulos no fim', () => {
    render(
      <DataTable
        columns={colunas}
        rows={[
          { titulo: 'sem dado', vendidos: null },
          { titulo: 'poucas', vendidos: 100 },
          { titulo: 'muitas', vendidos: 1000 },
        ]}
        rowKey={(l) => l.titulo}
        defaultSort={{ key: 'vendidos', dir: 'desc' }}
      />
    );

    expect(textoDasLinhas()).toEqual(['muitas1000', 'poucas100', 'sem dado—']);
  });

  it('sem defaultSort: preserva a ordem recebida', () => {
    render(
      <DataTable
        columns={colunas}
        rows={[
          { titulo: 'poucas', vendidos: 100 },
          { titulo: 'muitas', vendidos: 1000 },
        ]}
        rowKey={(l) => l.titulo}
      />
    );

    expect(textoDasLinhas()).toEqual(['poucas100', 'muitas1000']);
  });
});
