import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BotaoExportar } from '../botao-exportar';

describe('BotaoExportar', () => {
  it('fica bloqueado enquanto os dados do relatório carregam', () => {
    const { rerender } = render(<BotaoExportar montarReport={vi.fn()} disabled />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    rerender(<BotaoExportar montarReport={vi.fn()} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  });
});
