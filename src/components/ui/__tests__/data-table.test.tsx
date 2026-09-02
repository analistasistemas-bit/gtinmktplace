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

// A coluna fixa do Sonar cobria "Envio" em 1440 e cinco colunas em 820, e a região que tinha foco
// não era a que rolava (medido: scrollWidth === clientWidth === 740 no wrapper externo).
describe('DataTable — coluna fixa e rolagem horizontal', () => {
  const comAcoes: Column<Linha>[] = [
    ...colunas,
    { key: 'acoes', header: 'Ações', cell: () => 'ok', stickyRight: true },
  ];
  const linha = [{ titulo: 'a', vendidos: 1 }];

  it('há um único contêiner rolável, e ele é a região focável', () => {
    const { container } = render(
      <DataTable columns={comAcoes} rows={linha} rowKey={(l) => l.titulo} />,
    );
    const rolaveis = container.querySelectorAll('.overflow-x-auto');
    expect(rolaveis).toHaveLength(1);
    const regiao = screen.getByRole('region', { name: 'Tabela de dados' });
    expect(regiao).toBe(rolaveis[0]);
    expect(regiao).toHaveAttribute('tabindex', '0');
  });

  it('com coluna fixa a tabela dimensiona pelo conteúdo — rola em vez de comprimir', () => {
    const { container } = render(
      <DataTable columns={comAcoes} rows={linha} rowKey={(l) => l.titulo} />,
    );
    expect(container.querySelector('table')).toHaveClass('w-max', 'min-w-full');
  });

  it('sem coluna fixa a tabela continua ocupando a largura do contêiner', () => {
    const { container } = render(
      <DataTable columns={colunas} rows={linha} rowKey={(l) => l.titulo} />,
    );
    expect(container.querySelector('table')).not.toHaveClass('w-max');
  });

  it('a borda arredondada da tabela fica no contêiner que rola, não num pai sem rolagem', () => {
    const { container } = render(
      <DataTable columns={comAcoes} rows={linha} rowKey={(l) => l.titulo} />,
    );
    expect(container.querySelector('.overflow-x-auto')).toHaveClass('rounded-lg', 'border');
  });
});
