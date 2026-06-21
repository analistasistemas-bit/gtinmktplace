import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

function renderBc(items: { label: string; to?: string }[]) {
  return render(
    <MemoryRouter>
      <Breadcrumbs items={items} />
    </MemoryRouter>,
  );
}

describe('Breadcrumbs', () => {
  it('itens com `to` viram link com o href certo', () => {
    renderBc([{ label: 'Financeiro', to: '/financeiro' }, { label: 'Detalhe das vendas' }]);
    expect(screen.getByRole('link', { name: 'Financeiro' })).toHaveAttribute('href', '/financeiro');
  });

  it('o último item é a página atual: texto, não link, com aria-current', () => {
    renderBc([{ label: 'Publicados', to: '/publicados' }, { label: 'Detalhe de vendas' }]);
    expect(screen.queryByRole('link', { name: 'Detalhe de vendas' })).toBeNull();
    expect(screen.getByText('Detalhe de vendas')).toHaveAttribute('aria-current', 'page');
  });

  it('expõe nav rotulada', () => {
    renderBc([{ label: 'Dashboard', to: '/' }, { label: 'Lote #43' }]);
    expect(screen.getByRole('navigation', { name: /naveg/i })).toBeInTheDocument();
  });
});
