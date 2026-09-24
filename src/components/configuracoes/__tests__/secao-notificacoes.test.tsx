import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mutate = vi.fn();
const mutatePromo = vi.fn();
let ativo = false;
let ativoPromo = false;
let podeEditar = true;
vi.mock('@/hooks/useConfiguracoes', () => ({
  useMonitorFreteAtivo: () => ({ data: ativo }),
  useSalvarMonitorFreteAtivo: () => ({ mutate, isPending: false, isSuccess: false, isError: false }),
  useAlertasPromocoesAtivo: () => ({ data: ativoPromo }),
  useSalvarAlertasPromocoesAtivo: () => ({ mutate: mutatePromo, isPending: false, isSuccess: false, isError: false }),
}));
vi.mock('../permissoes', () => ({ usePermissoesConfig: () => ({ podeEditarConfig: podeEditar }) }));
vi.mock('@/components/config-telegram', () => ({ ConfigTelegram: () => <div data-testid="telegram" /> }));

import { SecaoNotificacoes } from '../secao-notificacoes';

describe('SecaoNotificacoes — monitor de frete', () => {
  beforeEach(() => { mutate.mockReset(); mutatePromo.mockReset(); ativo = false; ativoPromo = false; podeEditar = true; });

  it('mostra o switch desligado e liga ao clicar', () => {
    render(<SecaoNotificacoes />);
    const sw = screen.getByRole('switch', { name: /monitor de frete/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(mutate).toHaveBeenCalledWith(true);
  });

  it('reflete o valor salvo', () => {
    ativo = true;
    render(<SecaoNotificacoes />);
    expect(screen.getByRole('switch', { name: /monitor de frete/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('não-admin vê desabilitado', () => {
    podeEditar = false;
    render(<SecaoNotificacoes />);
    expect(screen.getByRole('switch', { name: /monitor de frete/i })).toBeDisabled();
  });
});

describe('SecaoNotificacoes — promoções', () => {
  beforeEach(() => { mutate.mockReset(); mutatePromo.mockReset(); ativo = false; ativoPromo = false; podeEditar = true; });

  it('switch de promoções chama o mutate com true', () => {
    render(<SecaoNotificacoes />);
    const sw = screen.getByRole('switch', { name: /promoções/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(mutatePromo).toHaveBeenCalledWith(true);
  });
});
