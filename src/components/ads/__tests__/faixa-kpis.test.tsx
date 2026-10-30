import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FaixaKpis } from '../faixa-kpis';
import type { ValorAds } from '../../../../supabase/functions/_shared/ads/metricas';

const v = (valor: number | null, motivo: ValorAds['motivo'] = null): ValorAds => ({ valor, motivo });
const base = (o: Record<string, ValorAds> = {}): Record<string, ValorAds> => ({
  investimento: v(100), vendas: v(12), receita: v(850.5), roas: v(8.5), acos: v(0.1176),
  tacos: v(0.05), impressoes: v(10000), cliques: v(300), ctr: v(0.03), cpc: v(0.33), conversao: v(0.04), ...o,
});

describe('FaixaKpis', () => {
  it('Vendas por Ads mostra quantidade e a receita identificada à parte', () => {
    render(<FaixaKpis atual={base()} anterior={null} comparacao="desligada" />);
    const tile = screen.getByText('Vendas por Ads').closest('[data-kpi]') as HTMLElement;
    expect(tile.textContent).toContain('12');
    expect(tile.textContent).toMatch(/R\$\s850,50 em receita/);
  });

  it('indisponível mostra o motivo em texto', () => {
    render(<FaixaKpis atual={base({ tacos: v(null, 'sem_denominador') })} anterior={null} comparacao="desligada" />);
    const tile = screen.getByText('TACOS da conta').closest('[data-kpi]') as HTMLElement;
    expect(tile.textContent).toContain('Indisponível');
    expect(tile.textContent).toMatch(/denominador/i);
  });

  it('queda de ACOS: seta para baixo com tom success', () => {
    render(<FaixaKpis atual={base({ acos: v(0.1) })} anterior={base({ acos: v(0.2) })} comparacao="disponivel" />);
    const delta = screen.getByText('ACOS').closest('[data-kpi]')!.querySelector('[data-delta]') as HTMLElement;
    expect(delta.getAttribute('data-direcao')).toBe('down');
    expect(delta.getAttribute('data-tom')).toBe('success');
    expect(delta.className).toContain('text-success');
  });

  it('comparação provisória: tom neutro e selo Provisória', () => {
    render(<FaixaKpis atual={base({ acos: v(0.1) })} anterior={base({ acos: v(0.2) })} comparacao="provisoria" />);
    const delta = screen.getByText('ACOS').closest('[data-kpi]')!.querySelector('[data-delta]') as HTMLElement;
    expect(delta.getAttribute('data-tom')).toBe('neutral');
    expect(screen.getAllByText('Provisória').length).toBeGreaterThan(0);
  });

  it('mobile: botão revela os 6 indicadores restantes', () => {
    render(<FaixaKpis atual={base()} anterior={null} comparacao="desligada" />);
    const ocultos = () => document.querySelectorAll('[data-kpi].hidden');
    expect(ocultos()).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todos os indicadores' }));
    expect(ocultos()).toHaveLength(0);
  });
});
