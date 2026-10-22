// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QuantoVende } from '../QuantoVende';

afterEach(() => cleanup());
const AGORA = new Date('2026-10-22T12:00:00Z');

describe('QuantoVende (observado)', () => {
  it('faixa, idade com semáforo e mínimo por mês', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+1000 vendidos', criadoEm: '2026-04-25T12:00:00Z' }} catalogo={false} agora={AGORA} />);
    screen.getByText('Observado');
    screen.getByText('+1.000');
    screen.getByText('180 dias');
    expect(screen.getByTitle('Criado em 25/04/2026').classList.contains('verde')).toBe(true);
    screen.getByText('≥ 169/mês');
  });

  it('sem data: só a faixa e o motivo, sem idade nem mínimo', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+1000 vendidos', criadoEm: null }} catalogo={false} agora={AGORA} />);
    screen.getByText('+1.000');
    expect(screen.queryByText(/dias$/)).toBeNull();
    expect(screen.queryByText(/\/mês/)).toBeNull();
    screen.getByText(/Data de criação indisponível/);
  });

  it('catálogo: sem mínimo por mês', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+1000 vendidos', criadoEm: '2026-04-25T12:00:00Z' }} catalogo agora={AGORA} />);
    expect(screen.queryByText(/\/mês/)).toBeNull();
  });

  it('nada observado → não renderiza', () => {
    const { container } = render(<QuantoVende observado={{ vendidosTexto: null, criadoEm: null }} catalogo={false} agora={AGORA} />);
    expect(container.innerHTML).toBe('');
  });
});
