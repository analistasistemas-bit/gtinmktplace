import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarraSelecaoPublicados } from '../barra-selecao-publicados';

describe('BarraSelecaoPublicados', () => {
  it('some sem seleção', () => {
    const { container } = render(<BarraSelecaoPublicados ativos={0} pausados={0} onPausar={vi.fn()} onReativar={vi.fn()} onLimpar={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('contagens e botões; 0 desabilita', async () => {
    const onPausar = vi.fn();
    render(<BarraSelecaoPublicados ativos={2} pausados={0} onPausar={onPausar} onReativar={vi.fn()} onLimpar={vi.fn()} />);
    expect(screen.getByText('2 selecionados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reativar 0' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Pausar 2' }));
    expect(onPausar).toHaveBeenCalled();
  });
});
