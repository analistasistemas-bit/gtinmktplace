import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarraFiltrosEstoque } from '../barra-filtros-estoque';

const props = {
  termo: '', filtro: 'todos' as const, ordem: 'nome' as const,
  canaisCarregando: false, canaisErro: false,
  onTermo: vi.fn(), onFiltro: vi.fn(), onOrdem: vi.fn(),
};

describe('BarraFiltrosEstoque', () => {
  it('digitar na busca emite o termo', async () => {
    const onTermo = vi.fn();
    const user = userEvent.setup();
    render(<BarraFiltrosEstoque {...props} onTermo={onTermo} />);
    await user.type(screen.getByPlaceholderText(/Buscar por nome, código, SKU, GTIN/), 'abc');
    expect(onTermo).toHaveBeenCalled();
  });

  // Loading é transitório — desabilita, mas não pode exibir o mesmo erro duro do isError.
  it('com canais carregando, o filtro "não publicado" fica desabilitado sem mensagem de erro', () => {
    render(<BarraFiltrosEstoque {...props} canaisCarregando />);
    expect(screen.getByRole('button', { name: 'Não publicado' })).toBeDisabled();
    expect(screen.queryByText(/não foi possível carregar os canais/i)).not.toBeInTheDocument();
  });

  // A UI não pode oferecer um filtro que ela sabe que responderia errado.
  it('com canais em erro, o filtro "não publicado" fica desabilitado e o motivo aparece', () => {
    render(<BarraFiltrosEstoque {...props} canaisErro />);
    expect(screen.getByRole('button', { name: 'Não publicado' })).toBeDisabled();
    expect(screen.getByText(/não foi possível carregar os canais/i)).toBeInTheDocument();
  });

  it('com canais disponíveis o filtro está habilitado', () => {
    render(<BarraFiltrosEstoque {...props} />);
    expect(screen.getByRole('button', { name: 'Não publicado' })).toBeEnabled();
  });
});
