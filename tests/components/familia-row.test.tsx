import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FamiliaRow } from '@/components/familia-row';
import type { Familia } from '@/lib/mocks/types';

const FAMILIA: Familia = {
  id: 'familia-1',
  loteId: 'lote-42',
  codigoPai: '1043812',
  titulo: 'Linha de Costura Algodão 500m',
  descricao: 'Linha 100% algodão...',
  operacao: 'CREATE',
  estrategiaPreco: 'PROPRIO',
  estrategiaMotivo: 'Nenhum concorrente',
  concorrencia: 'sem',
  precoMin: 8.9,
  precoMax: 12.5,
  precoAbaixo20pc: false,
  variacoes: [
    { codigo: '1043812-01', cor: 'Vermelho', corHex: '#dc2626', preco: 8.9, estoque: 50 },
  ],
};

describe('FamiliaRow', () => {
  it('mostra título, código PAI, operação e range de preço', () => {
    render(
      <FamiliaRow
        familia={FAMILIA}
        selecionada={false}
        expandida={false}
        onSelecionar={() => {}}
        onExpandir={() => {}}
      />
    );
    expect(screen.getByText(/Linha de Costura/)).toBeInTheDocument();
    expect(screen.getByText(/1043812/)).toBeInTheDocument();
    expect(screen.getByText(/CREATE/)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 8,90/)).toBeInTheDocument();
  });

  it('marca checkbox como checked quando selecionada=true', () => {
    render(
      <FamiliaRow
        familia={FAMILIA}
        selecionada={true}
        expandida={false}
        onSelecionar={() => {}}
        onExpandir={() => {}}
      />
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('mostra alerta de preço quando precoAbaixo20pc=true', () => {
    render(
      <FamiliaRow
        familia={{ ...FAMILIA, precoAbaixo20pc: true }}
        selecionada={false}
        expandida={false}
        onSelecionar={() => {}}
        onExpandir={() => {}}
      />
    );
    expect(screen.getByLabelText(/preço abaixo de 20%/i)).toBeInTheDocument();
  });
});
