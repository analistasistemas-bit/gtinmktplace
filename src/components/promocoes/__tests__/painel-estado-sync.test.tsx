import { describe, expect, it, vi } from 'vitest';
import { render as renderRtl, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { PainelEstadoSync } from '../painel-estado-sync';

const render = (ui: ReactElement) => renderRtl(<MemoryRouter>{ui}</MemoryRouter>);

describe('PainelEstadoSync', () => {
  it('nunca sincronizado: convida a buscar', () => {
    const onAtualizar = vi.fn();
    render(<PainelEstadoSync estado={null} temDados={false} onAtualizar={onAtualizar} atualizando={false} />);
    expect(screen.getByText('Ainda não buscamos as promoções desta conta.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar promoções agora' }));
    expect(onAtualizar).toHaveBeenCalled();
  });

  it('sem acesso: explica e aponta Canais', () => {
    render(<PainelEstadoSync estado={{ estado: 'sem_acesso', iniciado_em: null, ultimo_ok_em: null, ultimo_erro_em: null, erro: 'ML 403' }}
      temDados={false} onAtualizar={() => {}} atualizando={false} />);
    expect(screen.getByText('O Mercado Livre não liberou promoções para esta conta.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reconectar em Canais' }).getAttribute('href')).toContain('/canais');
  });

  it('erro com dados antigos: faixa de aviso, não esconde os dados', () => {
    render(<PainelEstadoSync estado={{ estado: 'erro', iniciado_em: null, ultimo_ok_em: '2026-10-06T11:00:00Z', ultimo_erro_em: '2026-10-06T17:00:00Z', erro: 'x' }}
      temDados onAtualizar={() => {}} atualizando={false} />);
    expect(screen.getByText(/A última atualização falhou/)).toBeTruthy();
  });

  it('ok com dados: não renderiza nada', () => {
    const { container } = render(<PainelEstadoSync estado={{ estado: 'ok', iniciado_em: null, ultimo_ok_em: '2026-10-06T11:00:00Z', ultimo_erro_em: null, erro: null }}
      temDados onAtualizar={() => {}} atualizando={false} />);
    expect(container.textContent).toBe('');
  });
});
