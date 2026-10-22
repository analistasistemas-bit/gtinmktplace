// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Vendedor } from '../Vendedor';

afterEach(() => cleanup());
const base = { nickname: 'LOJA X', nivel: '5_green', medalha: 'platinum', vendas: 12345, periodo: null, uf: 'SP' };

describe('Vendedor (ADR-0189 D-10)', () => {
  it('nome, UF, reputação com cor, medalha e vendas', () => {
    render(<Vendedor vendedor={base} />);
    screen.getByText('LOJA X');
    screen.getByText('SP');
    expect(screen.getByTitle('Reputação 5_green').classList.contains('verde')).toBe(true);
    screen.getByText('Verde');
    screen.getByText('MercadoLíder Platinum');
    screen.getByText('12.345');
  });

  it('sem período em dias: rótulo neutro, nunca "histórico"', () => {
    render(<Vendedor vendedor={base} />);
    expect(screen.queryByText(/hist[óo]ric/i)).toBeNull();
    screen.getByText('Vendas');
  });

  it('com período informado pelo ML: mostra o período', () => {
    render(<Vendedor vendedor={{ ...base, periodo: 'últimos 365 dias' }} />);
    screen.getByText('Vendas nos últimos 365 dias');
  });

  it('sem medalha nem reputação: não inventa', () => {
    render(<Vendedor vendedor={{ ...base, nivel: null, medalha: null }} />);
    expect(screen.queryByText(/MercadoLíder/)).toBeNull();
    screen.getByText('Sem reputação');
  });

  it('loja oficial: mostra o selo com o nome da loja quando difere do apelido', () => {
    render(<Vendedor vendedor={{ ...base, nickname: 'TRAMONTINA-OFICIAL' }} lojaOficial={{ nome: 'Tramontina' }} />);
    screen.getByText('Loja oficial Tramontina');
  });

  it('loja oficial com nome igual ao apelido ou sem nome: só "Loja oficial"', () => {
    render(<Vendedor vendedor={{ ...base, nickname: 'BOING' }} lojaOficial={{ nome: 'Boing' }} />);
    screen.getByText('Loja oficial');
    cleanup();
    render(<Vendedor vendedor={base} lojaOficial={{ nome: null }} />);
    screen.getByText('Loja oficial');
  });

  it('sem prova de loja oficial: nada aparece', () => {
    render(<Vendedor vendedor={base} />);
    expect(screen.queryByText(/Loja oficial/)).toBeNull();
  });
});
