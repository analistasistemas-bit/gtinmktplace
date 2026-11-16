import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogAtacado } from '../dialog-atacado';
import type { PlanoAtacado } from '@/lib/atacado-publicados';

const plano = (over: Partial<PlanoAtacado> = {}): PlanoAtacado => ({
  familias: ['F1'], produtos: [{ codigoPai: 'P1', familiaId: 'F1', titulo: 'Creme', ehKit: false }], fora: [], faixasIniciais: [], ...over,
});

describe('DialogAtacado', () => {
  it('começa sem faixa: Ver preview desabilitado até criar uma', async () => {
    const onVerPreview = vi.fn();
    render(<DialogAtacado plano={plano()} precoBase={20} onFechar={() => {}} onVerPreview={onVerPreview} />);
    expect(screen.getByRole('button', { name: 'Ver preview' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Adicionar faixa/ }));
    expect(screen.getByText(/R\$ 19,00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver preview' }));
    expect(onVerPreview).toHaveBeenCalledWith([{ min_unidades: 5, desconto_pct: 5 }]);
  });

  it('parte das faixas comuns e mostra os que ficam fora e o aviso de kit', () => {
    render(<DialogAtacado
      plano={plano({
        faixasIniciais: [{ min_unidades: 3, desconto_pct: 5 }],
        produtos: [{ codigoPai: 'P1', familiaId: 'F1', titulo: 'Kit 2', ehKit: true }],
        fora: [{ codigoPai: 'P2', titulo: 'Outro', motivo: 'Atacado por cor: ajuste na Revisão' }],
      })}
      precoBase={null} onFechar={() => {}} onVerPreview={() => {}}
    />);
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    expect(screen.getByText(/a quantidade conta kits/)).toBeInTheDocument();
    expect(screen.getByText(/Atacado por cor: ajuste na Revisão/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver preview' })).toBeEnabled();
  });

  it('nenhum elegível: só explica, sem Ver preview', () => {
    render(<DialogAtacado plano={plano({ familias: [], produtos: [], fora: [{ codigoPai: 'K', titulo: 'Kit', motivo: 'Kit Virtual não tem atacado' }] })}
      precoBase={null} onFechar={() => {}} onVerPreview={() => {}} />);
    expect(screen.getByText('Nenhum produto selecionado aceita atacado por aqui.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver preview' })).toBeNull();
  });

  it('desconto decimal (5,5%) segue para o preview', async () => {
    const onVerPreview = vi.fn();
    render(<DialogAtacado plano={plano({ faixasIniciais: [{ min_unidades: 3, desconto_pct: 5.5 }] })} precoBase={20} onFechar={() => {}} onVerPreview={onVerPreview} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver preview' }));
    expect(onVerPreview).toHaveBeenCalledWith([{ min_unidades: 3, desconto_pct: 5.5 }]);
  });
});
