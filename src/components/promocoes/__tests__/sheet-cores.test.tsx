import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SheetCores } from '../sheet-cores';
import type { ItemPromocao } from '@/lib/promocoes';

const item = {
  ml_item_id: 'MLB1', titulo: 'Jogo de cama', status: 'candidate', preco_avaliado: 69.9, pior_semaforo: 'vermelho',
  projecao: [
    { variation_id: 1, cor: 'Azul', sku: null, custo: 20, piso: 30, origem: 'nacional', liquido: 32, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null },
    { variation_id: 2, cor: 'Rosa', sku: null, custo: 40, piso: 45, origem: 'nacional', liquido: 36.9, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'vermelho', motivo: null },
    { variation_id: 3, cor: 'Verde', sku: null, custo: null, piso: null, origem: null, liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'indisponivel', motivo: 'sem_cadastro' },
  ],
} as unknown as ItemPromocao;

describe('SheetCores', () => {
  it('uma linha por cor, com líquido, markup e o motivo quando não há líquido', () => {
    render(<SheetCores item={item} onClose={() => {}} />);
    expect(screen.getByText('Azul')).toBeTruthy();
    expect(screen.getByText('Rosa')).toBeTruthy();
    expect(screen.getByText('Sem custo no PubliAI')).toBeTruthy();
    expect(screen.getByText('+60%')).toBeTruthy(); // (32 − 20) / 20
  });
});
