import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FamiliaRow } from '@/components/familia-row';
import type { Familia } from '@/lib/tipos-dominio';

function renderWithClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

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
  status: 'pronto',
};

describe('FamiliaRow', () => {
  it('mostra título, código PAI, operação e range de preço', () => {
    renderWithClient(
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
    renderWithClient(
      <FamiliaRow
        familia={FAMILIA}
        selecionada={true}
        expandida={false}
        onSelecionar={() => {}}
        onExpandir={() => {}}
      />
    );
    expect(screen.getByRole('checkbox', { name: 'Selecionar família' })).toBeChecked();
  });

  it('clicar na área da linha expande a família', () => {
    const onExpandir = vi.fn();
    renderWithClient(
      <FamiliaRow
        familia={FAMILIA}
        selecionada={false}
        expandida={false}
        onSelecionar={() => {}}
        onExpandir={onExpandir}
      />
    );
    fireEvent.click(screen.getByText(/Linha de Costura/));
    expect(onExpandir).toHaveBeenCalledWith('familia-1');
  });

  it('clicar no checkbox de seleção não expande', () => {
    const onExpandir = vi.fn();
    renderWithClient(
      <FamiliaRow
        familia={FAMILIA}
        selecionada={false}
        expandida={false}
        onSelecionar={() => {}}
        onExpandir={onExpandir}
      />
    );
    // O clique borbulha no DOM; a linha deve ignorá-lo por vir de um controle interativo.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar família' }));
    expect(onExpandir).not.toHaveBeenCalled();
  });

  it('mostra alerta de preço quando precoAbaixo20pc=true', () => {
    renderWithClient(
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
