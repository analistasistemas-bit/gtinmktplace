import { describe, expect, it, vi } from 'vitest';
import { render as renderRtl, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { PainelEstadoSync } from '../painel-estado-sync';

const render = (ui: ReactElement) => renderRtl(<MemoryRouter>{ui}</MemoryRouter>);

describe('PainelEstadoSync', () => {
  it('nunca sincronizado: convida a buscar', () => {
    const onAtualizar = vi.fn();
    render(<PainelEstadoSync estado={null} temDados={false} onAtualizar={onAtualizar} atualizando={false} agoraMs={0} />);
    expect(screen.getByText('Ainda não buscamos as promoções desta conta.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar promoções agora' }));
    expect(onAtualizar).toHaveBeenCalled();
  });

  it('sem acesso: explica e aponta Canais', () => {
    render(<PainelEstadoSync estado={{ estado: 'sem_acesso', iniciado_em: null, ultimo_ok_em: null, ultimo_erro_em: null, erro: 'ML 403' }}
      temDados={false} onAtualizar={() => {}} atualizando={false} agoraMs={0} />);
    expect(screen.getByText('O Mercado Livre não liberou promoções para esta conta.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reconectar em Canais' }).getAttribute('href')).toContain('/canais');
  });

  it('erro com dados antigos: faixa de aviso, não esconde os dados', () => {
    render(<PainelEstadoSync estado={{ estado: 'erro', iniciado_em: null, ultimo_ok_em: '2026-10-06T11:00:00Z', ultimo_erro_em: '2026-10-06T17:00:00Z', erro: 'x' }}
      temDados onAtualizar={() => {}} atualizando={false} agoraMs={0} />);
    expect(screen.getByText(/A última atualização falhou/)).toBeTruthy();
  });

  it('sincronizando há < 5 min sem dados: buscando', () => {
    const agora = Date.parse('2026-10-06T12:00:00Z');
    render(<PainelEstadoSync estado={{ estado: 'sincronizando', iniciado_em: '2026-10-06T11:58:00Z', ultimo_ok_em: null, ultimo_erro_em: null, erro: null }}
      temDados={false} onAtualizar={() => {}} atualizando={false} agoraMs={agora} />);
    expect(screen.getByText('Buscando as promoções no Mercado Livre…')).toBeTruthy();
  });

  it('sincronizando parado há > 5 min sem dados: volta a oferecer a busca', () => {
    const agora = Date.parse('2026-10-06T12:00:00Z');
    render(<PainelEstadoSync estado={{ estado: 'sincronizando', iniciado_em: '2026-10-06T11:50:00Z', ultimo_ok_em: null, ultimo_erro_em: null, erro: null }}
      temDados={false} onAtualizar={() => {}} atualizando={false} agoraMs={agora} />);
    expect(screen.queryByText('Buscando as promoções no Mercado Livre…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Buscar promoções agora' })).toBeTruthy();
  });

  it('sincronizando parado com erro anterior sem dados: mostra o erro', () => {
    const agora = Date.parse('2026-10-06T12:00:00Z');
    render(<PainelEstadoSync estado={{ estado: 'sincronizando', iniciado_em: '2026-10-06T11:50:00Z', ultimo_ok_em: null, ultimo_erro_em: null, erro: 'ML 500' }}
      temDados={false} onAtualizar={() => {}} atualizando={false} agoraMs={agora} />);
    expect(screen.getByText('Não foi possível buscar as promoções.')).toBeTruthy();
  });

  it('ok com dados: não renderiza nada', () => {
    const { container } = render(<PainelEstadoSync estado={{ estado: 'ok', iniciado_em: null, ultimo_ok_em: '2026-10-06T11:00:00Z', ultimo_erro_em: null, erro: null }}
      temDados onAtualizar={() => {}} atualizando={false} agoraMs={0} />);
    expect(container.textContent).toBe('');
  });
});
