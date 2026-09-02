import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SecaoSonar } from '../secao-sonar';

describe('SecaoSonar', () => {
  it('sem a prop de colapso, o conteúdo está sempre visível e não há botão', () => {
    render(<SecaoSonar titulo="Vendas do nicho"><p>conteúdo</p></SecaoSonar>);
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vendas do nicho/ })).not.toBeInTheDocument();
  });

  it('colapsável fechada por padrão esconde o conteúdo e anuncia o estado', async () => {
    render(
      <SecaoSonar titulo="Dá lucro?" colapsavelAbertaPorPadrao={false}><p>conteúdo</p></SecaoSonar>,
    );
    const botao = screen.getByRole('button', { name: /Dá lucro\?/ });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
    await userEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });

  it('o título é um heading — o leitor de tela navega por eles', () => {
    render(<SecaoSonar titulo="Quem vende neste nicho"><p>x</p></SecaoSonar>);
    expect(screen.getByRole('heading', { name: 'Quem vende neste nicho' })).toBeInTheDocument();
  });
});
