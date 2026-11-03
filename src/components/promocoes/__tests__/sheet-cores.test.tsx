import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SheetCores } from '../sheet-cores';
import type { ItemPromocao } from '@/lib/promocoes';

const tarifa = { comissao_pct: 14, comissao_fixa: 0, frete: 8.25, aliquota_pct: 4 };
const item = {
  ml_item_id: 'MLB1', titulo: 'Jogo de cama', status: 'candidate', preco_avaliado: 49.9, pior_semaforo: 'vermelho',
  projecao: [
    { variation_id: 1, cor: 'Azul', sku: null, custo: 18.5, piso: 28.5, origem: 'nacional', ...tarifa, liquido: 32.664, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null },
    { variation_id: 2, cor: 'Rosa', sku: null, custo: 40, piso: 45, origem: 'nacional', ...tarifa, liquido: 32.664, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'vermelho', motivo: null },
    { variation_id: 3, cor: 'Verde', sku: null, custo: null, piso: null, origem: null, comissao_pct: null, comissao_fixa: null, frete: null, aliquota_pct: null, liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'indisponivel', motivo: 'sem_cadastro' },
  ],
} as unknown as ItemPromocao;

describe('SheetCores', () => {
  it('por cor, o mesmo "Você recebe por venda" de Publicados; motivo quando não há líquido', () => {
    render(<SheetCores item={item} onClose={() => {}} />);
    expect(screen.getByText('Azul')).toBeTruthy();
    expect(screen.getAllByText('Você recebe por venda')).toHaveLength(2);
    expect(screen.getAllByText(/comissão −R\$ 6,99 \(14%\)/)).toHaveLength(2);
    expect(screen.getAllByText(/imposto −R\$ 2,00 \(4%\)/)).toHaveLength(2);
    expect(screen.getAllByText(/por sua conta −R\$ 8,25/)).toHaveLength(2);
    expect(screen.getByText('R$ 14,16')).toBeTruthy(); // lucro Azul: 32,664 − 18,50
    expect(screen.getByText('77%')).toBeTruthy();
    expect(screen.getByText(/prejuízo/)).toBeTruthy(); // Rosa: 32,66 − 40
    expect(screen.getByText('Sem custo no PubliAI')).toBeTruthy();
  });

  it('simulado: o cabeçalho diz que o preço é o simulado', () => {
    render(<SheetCores item={item} simulado onClose={() => {}} />);
    expect(screen.getByText(/preço simulado R\$ 49,90/)).toBeTruthy();
  });
});
