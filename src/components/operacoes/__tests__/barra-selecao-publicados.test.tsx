import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarraSelecaoPublicados } from '../barra-selecao-publicados';

const props = { onPausar: vi.fn(), onReativar: vi.fn(), onReajustar: vi.fn(), onLimpar: vi.fn() };

describe('BarraSelecaoPublicados', () => {
  it('some sem seleção', () => {
    const { container } = render(<BarraSelecaoPublicados ativos={0} pausados={0} {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('contagens e botões; 0 desabilita', async () => {
    const onPausar = vi.fn();
    render(<BarraSelecaoPublicados ativos={2} pausados={0} {...props} onPausar={onPausar} />);
    expect(screen.getByText('2 selecionados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reativar 0' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Pausar 2' }));
    expect(onPausar).toHaveBeenCalled();
  });
  it('Reajustar preço conta ativos + pausados', async () => {
    const onReajustar = vi.fn();
    render(<BarraSelecaoPublicados ativos={2} pausados={3} {...props} onReajustar={onReajustar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reajustar preço (5)' }));
    expect(onReajustar).toHaveBeenCalled();
  });
});
