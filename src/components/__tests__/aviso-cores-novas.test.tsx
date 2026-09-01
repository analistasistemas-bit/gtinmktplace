import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AvisoCoresNovas } from '@/components/aviso-cores-novas';
import type { FamiliaCorNova } from '@/lib/cores-novas';

const CORES_NOVAS: FamiliaCorNova[] = [
  { codigoPai: '1001', titulo: 'Linha Vermelha', codigos: ['A1', 'A2'] },
  { codigoPai: '1002', titulo: 'Botão Azul', codigos: ['B1'] },
];

describe('AvisoCoresNovas', () => {
  it('inicia recolhido — resumo compacto sem listar famílias inline', () => {
    render(<AvisoCoresNovas coresNovas={CORES_NOVAS} totalCoresNovas={3} />);

    expect(screen.getByText(/3 cor\(es\) nova\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/Afetam 2 famílias\./)).toBeInTheDocument();
    expect(screen.queryByText('Linha Vermelha')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver famílias afetadas/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('expande e recolhe a lista de famílias', async () => {
    const user = userEvent.setup();
    render(<AvisoCoresNovas coresNovas={CORES_NOVAS} totalCoresNovas={3} />);

    const toggle = screen.getByRole('button', { name: /Ver famílias afetadas/i });
    await user.click(toggle);

    expect(screen.getByText('Linha Vermelha')).toBeInTheDocument();
    expect(screen.getByText('Botão Azul')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recolher aviso/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.click(screen.getByRole('button', { name: /Recolher aviso/i }));
    expect(screen.queryByText('Linha Vermelha')).not.toBeInTheDocument();
  });
});
