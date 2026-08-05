import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarraFiltrosEstoque } from '../barra-filtros-estoque';

// jsdom não implementa scrollIntoView, e o Radix Select chama ao mover o item ativo pelo
// teclado. Stub local ao arquivo — não vale poluir o setup global por um componente.
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });

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
    await user.type(screen.getByPlaceholderText(/Buscar por nome, código, SKU/), 'abc');
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

  // Os botões de filtro são toggles excludentes — sem `aria-pressed`, tecnologia assistiva não
  // tem como saber qual está ativo.
  it('marca aria-pressed só no filtro selecionado', () => {
    render(<BarraFiltrosEstoque {...props} filtro="sem-estoque" />);

    expect(screen.getByRole('button', { name: 'Sem estoque' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Não publicado' })).toHaveAttribute('aria-pressed', 'false');
  });

  // Ordenação deixou de ser um trio de botões idênticos aos de filtro: virou um select rotulado,
  // que precisa expor o critério em vigor sem o operador ter que abrir a lista.
  it('a ordenação é um select rotulado que mostra o critério em vigor', () => {
    render(<BarraFiltrosEstoque {...props} ordem="saldo-asc" />);
    const seletor = screen.getByRole('combobox', { name: /ordenar por/i });
    expect(seletor).toHaveTextContent('Menor saldo');
    // Filtro e ordenação não podem voltar a ser o mesmo controle visual.
    expect(screen.queryByRole('button', { name: 'Menor saldo' })).not.toBeInTheDocument();
  });

  // O controle de ordenação foi REESCRITO (três botões → Select): sem isto, nada prova que
  // escolher uma opção chega a `onOrdem`. Mostrar o valor certo não é o mesmo que estar ligado.
  //
  // Por teclado, não por clique: o Radix Select usa `hasPointerCapture`, que o jsdom não
  // implementa — o caminho de ponteiro exigiria stub global. O teclado cobre o mesmo fio E
  // prova que a ordenação continua operável sem mouse.
  it('escolher uma opção do select emite a nova ordem (por teclado)', async () => {
    const onOrdem = vi.fn();
    const user = userEvent.setup();
    render(<BarraFiltrosEstoque {...props} onOrdem={onOrdem} />);

    screen.getByRole('combobox', { name: /ordenar por/i }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('option', { name: 'Menor saldo' });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onOrdem).toHaveBeenCalledWith('saldo-asc');
  });
});
