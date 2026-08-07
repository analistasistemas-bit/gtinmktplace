import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FiltrosMovimentos } from '@/components/estoque/filtros-movimentos';

function props(over: Partial<Parameters<typeof FiltrosMovimentos>[0]> = {}) {
  return {
    grupos: [], onGrupos: vi.fn(),
    periodo: null, onPeriodo: vi.fn(),
    codigo: null, onCodigo: vi.fn(),
    variacoes: [{ codigo: '00000005', cor: 'incolor' }],
    ...over,
  };
}

describe('FiltrosMovimentos', () => {
  it('marca Todos quando nenhum grupo está escolhido', () => {
    render(<FiltrosMovimentos {...props()} />);
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Entradas' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('escolher um grupo troca o recorte em vez de acumular', async () => {
    const p = props();
    render(<FiltrosMovimentos {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Entradas' }));
    expect(p.onGrupos).toHaveBeenCalledWith(['entradas']);
  });

  it('clicar no grupo já ativo volta para Todos', async () => {
    const p = props({ grupos: ['entradas'] });
    render(<FiltrosMovimentos {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Entradas' }));
    expect(p.onGrupos).toHaveBeenCalledWith([]);
  });

  it('Todos limpa o recorte de motivo', async () => {
    const p = props({ grupos: ['vendas'] });
    render(<FiltrosMovimentos {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Todos' }));
    expect(p.onGrupos).toHaveBeenCalledWith([]);
  });

  it('não oferece filtro de SKU quando o produto tem uma variação só', () => {
    render(<FiltrosMovimentos {...props()} />);
    expect(screen.queryByLabelText('Variação')).not.toBeInTheDocument();
  });

  it('oferece filtro de SKU quando há mais de uma variação', () => {
    render(<FiltrosMovimentos {...props({
      variacoes: [{ codigo: '00000005', cor: 'incolor' }, { codigo: '00000006', cor: 'azul' }],
    })} />);
    expect(screen.getByLabelText('Variação')).toBeInTheDocument();
  });

  it('abre em Todo o período e não pré-aplica data nenhuma', () => {
    render(<FiltrosMovimentos {...props()} />);
    expect(screen.getByRole('button', { name: /todo o per[íi]odo/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sair de Todo o período aplica o preset escolhido', async () => {
    const p = props();
    render(<FiltrosMovimentos {...p} />);
    await userEvent.click(screen.getByRole('button', { name: '30 dias' }));
    expect(p.onPeriodo).toHaveBeenCalledWith({ tipo: 'preset', dias: 30 });
  });

  it('voltar para Todo o período limpa a janela', async () => {
    const p = props({ periodo: { tipo: 'preset', dias: 30 } as const });
    render(<FiltrosMovimentos {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /todo o per[íi]odo/i }));
    expect(p.onPeriodo).toHaveBeenCalledWith(null);
  });

  // Pego só na validação visual: o SeletorPeriodo recebe um período de fallback quando estamos em
  // "Todo o período", e destacava o "30 dias" desse fallback — a tela mostrava dois filtros acesos
  // e sugeria um recorte de 30 dias que não estava aplicado.
  it('em Todo o período nenhum preset fica destacado', () => {
    render(<FiltrosMovimentos {...props()} />);
    for (const nome of ['Hoje', '7 dias', '30 dias', '90 dias']) {
      expect(screen.getByRole('button', { name: nome }).className).not.toMatch(/bg-primary/);
    }
  });

  it('com período aplicado o preset correspondente fica destacado', () => {
    render(<FiltrosMovimentos {...props({ periodo: { tipo: 'preset', dias: 30 } as const })} />);
    expect(screen.getByRole('button', { name: '30 dias' }).className).toMatch(/bg-primary/);
    expect(screen.getByRole('button', { name: '7 dias' }).className).not.toMatch(/bg-primary/);
  });
});
