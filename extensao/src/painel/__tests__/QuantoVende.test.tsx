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

  it('catálogo com faixa igual à do anúncio: agregado e ritmo do catálogo continuam (achado Codex)', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+1000 vendidos', vendidosAnuncio: '+1000 vendidos', criadoEm: '2026-04-25T12:00:00Z' }}
      catalogo catalogoCriadoEm="2020-07-30T21:40:56Z" agora={AGORA} />);
    screen.getByText('Catálogo, todos os vendedores');
    screen.getByText('desde 07/2020');
  });

  it('faixa da página igual à do anúncio → não repete', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+25 vendidos', vendidosAnuncio: '+25 vendidos', criadoEm: '2026-04-25T12:00:00Z' }} catalogo={false} agora={AGORA} />);
    expect(screen.getAllByText('+25').length).toBe(1);
    expect(screen.queryByText(/todos os/)).toBeNull();
  });

  it('sem os dados do anúncio e sem data do catálogo: só a faixa da página, rotulada, e o motivo — sem ritmo', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+1000 vendidos', vendidosAnuncio: null, criadoEm: null, motivo: 'HTTP 500' }} catalogo agora={AGORA} />);
    screen.getByText('Catálogo, todos os vendedores');
    screen.getByText('+1.000');
    expect(screen.queryByText('Este anúncio')).toBeNull();
    expect(screen.queryByText(/≥/)).toBeNull();
    screen.getByText('Vendas e idade deste anúncio indisponíveis (HTTP 500).');
  });

  it('catálogo com data: ritmo do catálogo (faixa ÷ idade do catálogo); captcha explicado sem jargão', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+1000 vendidos', vendidosAnuncio: null, criadoEm: null, motivo: 'página sem a data (79 KB → www.mercadolivre.com.br/captcha/wal…)' }}
      catalogo catalogoCriadoEm="2020-07-30T21:40:56Z" agora={AGORA} />);
    screen.getByText('Catálogo, todos os vendedores');
    screen.getByText('desde 07/2020');
    screen.getByText('≥ 13/mês');
    screen.getByText('≥ 0,4/dia');
    screen.getByText('Vendas e idade deste anúncio: o Mercado Livre não libera essa leitura para a extensão.');
  });

  it('faixa do anúncio +25: total estimado rotulado, com a conta e o erro medido', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+500 vendidos', vendidosAnuncio: '+25 vendidos', criadoEm: '2026-04-25T12:00:00Z' }} catalogo agora={AGORA} />);
    screen.getByText('Total estimado');
    screen.getByText('≈ 33');
    screen.getByText('Estimativa');
    screen.getByText(/Faixa \+25 × 1,3, calibrada em vendas reais de anúncios próprios \(amostra limitada; erro mediano medido 10%\)/);
  });

  it('estima só pela faixa do anúncio: agregado +50 com anúncio +5 não estima; faixa +100 não estima', () => {
    render(<QuantoVende observado={{ vendidosTexto: '+50 vendidos', vendidosAnuncio: '+5 vendidos', criadoEm: null }} catalogo agora={AGORA} />);
    expect(screen.queryByText('Total estimado')).toBeNull();
    cleanup();
    render(<QuantoVende observado={{ vendidosTexto: null, vendidosAnuncio: '+100 vendidos', criadoEm: null }} catalogo={false} agora={AGORA} />);
    expect(screen.queryByText('Total estimado')).toBeNull();
  });

  it('estado antigo (sem vendidosAnuncio) e nada observado → não renderiza', () => {
    const { container } = render(<QuantoVende observado={{ vendidosTexto: null, criadoEm: null }} catalogo={false} agora={AGORA} />);
    expect(container.innerHTML).toBe('');
  });
});
