import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogReajuste } from '../dialog-reajuste';

describe('DialogReajuste', () => {
  it('Diminuir R$ com vírgula → ajuste para o preview', async () => {
    const onVerPreview = vi.fn();
    render(<DialogReajuste quantidade={3} onFechar={() => {}} onVerPreview={onVerPreview} />);
    expect(screen.getByText(/3 anúncios selecionados/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Diminuir' }));
    await userEvent.click(screen.getByRole('button', { name: 'R$' }));
    await userEvent.type(screen.getByLabelText('Valor do ajuste'), '2,5');
    await userEvent.click(screen.getByRole('button', { name: 'Ver preview' }));
    expect(onVerPreview).toHaveBeenCalledWith({ tipo: 'reais', sentido: '-', valor: 2.5 });
  });

  it('padrão Aumentar %; valor inválido bloqueia', async () => {
    const onVerPreview = vi.fn();
    render(<DialogReajuste quantidade={1} onFechar={() => {}} onVerPreview={onVerPreview} />);
    expect(screen.getByRole('button', { name: 'Ver preview' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Valor do ajuste'), '1,234');
    expect(screen.getByText('Use no máximo 2 casas decimais.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver preview' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Valor do ajuste'));
    await userEvent.type(screen.getByLabelText('Valor do ajuste'), '10{Enter}');
    expect(onVerPreview).toHaveBeenCalledWith({ tipo: 'pct', sentido: '+', valor: 10 });
  });

  it('Definir R$ esconde Aumentar/Diminuir e envia o preço com sentido +', async () => {
    const onVerPreview = vi.fn();
    render(<DialogReajuste quantidade={2} onFechar={() => {}} onVerPreview={onVerPreview} />);
    expect(screen.getByRole('heading', { name: 'Alterar preço' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Diminuir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Definir R$' }));
    expect(screen.queryByRole('button', { name: 'Aumentar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Diminuir' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Valor do ajuste'), '149,90');
    await userEvent.click(screen.getByRole('button', { name: 'Ver preview' }));
    expect(onVerPreview).toHaveBeenCalledWith({ tipo: 'definir', sentido: '+', valor: 149.9 });
  });

  it('Diminuir 100% ou mais é recusado', async () => {
    render(<DialogReajuste quantidade={1} onFechar={() => {}} onVerPreview={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Diminuir' }));
    await userEvent.type(screen.getByLabelText('Valor do ajuste'), '100');
    expect(screen.getByText('Diminuir 100% ou mais zera o preço.')).toBeInTheDocument();
  });
});
