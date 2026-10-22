// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QuantoVende } from '../QuantoVende';

afterEach(() => cleanup());
const AGORA = new Date('2026-10-22T12:00:00Z');

describe('QuantoVende (observado)', () => {
  it('anúncio: faixa, idade com semáforo, por mês e por dia; faixa do catálogo à parte', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+1000 vendidos', vendidosAnuncio: '2 vendidos', criadoEm: '2026-10-07T23:50:26Z' }} catalogo agora={AGORA} />);
    screen.getByText('Observado');
    screen.getByText('Este anúncio');
    screen.getByText('2');
    screen.getByText('14 dias');
    expect(screen.getByTitle('Criado em 07/10/2026').classList.contains('verde')).toBe(true);
    screen.getByText('≥ 2');
    screen.getByText('≥ 0,1');
    screen.getByText('Catálogo, todos os vendedores');
    screen.getByText('+1.000');
  });

  it('faixa da página igual à do anúncio → não repete', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+25 vendidos', vendidosAnuncio: '+25 vendidos', criadoEm: '2026-04-25T12:00:00Z' }} catalogo={false} agora={AGORA} />);
    expect(screen.getAllByText('+25').length).toBe(1);
    expect(screen.queryByText(/todos os/)).toBeNull();
  });

  it('sem os dados do anúncio: só a faixa da página, rotulada, e o motivo — sem ritmo', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+1000 vendidos', vendidosAnuncio: null, criadoEm: null }} catalogo agora={AGORA} />);
    screen.getByText('Catálogo, todos os vendedores');
    screen.getByText('+1.000');
    expect(screen.queryByText('Este anúncio')).toBeNull();
    expect(screen.queryByText(/≥/)).toBeNull();
    screen.getByText(/Vendas e idade deste anúncio indisponíveis/);
  });

  it('estado antigo (sem vendidosAnuncio) e nada observado → não renderiza', () => {
    const { container } = render(<QuantoVende observado={{ vendidosTexto: null, criadoEm: null }} catalogo={false} agora={AGORA} />);
    expect(container.innerHTML).toBe('');
  });
});
