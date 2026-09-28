import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { PreviewOperacao } from '../preview-operacao';
import { useCriarOperacao, usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import type { CorProjetada, ItemPromocao } from '@/lib/promocoes';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useOperacoes', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperacoes')>('@/hooks/useOperacoes');
  return { ...actual, useCriarOperacao: vi.fn(), usePodeExecutarOperacao: vi.fn() };
});

function cor(over: Partial<CorProjetada> = {}): CorProjetada {
  return {
    variation_id: 1, cor: 'Azul', sku: null, custo: 5, piso: 10, origem: 'nacional',
    comissao_pct: 12, comissao_fixa: 0, frete: 0, aliquota_pct: 0,
    liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null,
    ...over,
  };
}
function item(over: Partial<ItemPromocao> = {}): ItemPromocao {
  return {
    ml_item_id: 'MLB1', status: 'candidate',
    preco_original: 100, preco_promo: 80, preco_min: 7, preco_max: 18.99,
    preco_sugerido: 10, preco_avaliado: 10, ml_pct: null, estoque_min: null,
    titulo: 'Produto', thumbnail: null, permalink: null,
    projecao: [cor()], pior_semaforo: 'verde',
    ...over,
  };
}

const mutateAsync = vi.fn();

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({ operacao_id: 'op1' });
  vi.mocked(useCriarOperacao).mockReturnValue({ mutateAsync, isPending: false } as never);
  vi.mocked(usePodeExecutarOperacao).mockReturnValue(true);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

function renderPreview(props: Partial<Parameters<typeof PreviewOperacao>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PreviewOperacao
        acao="aderir" tipo="DEAL" promocaoId="P1" promocaoNome="Campanha X"
        itens={[]} aberto onClose={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('PreviewOperacao', () => {
  it('DEAL aderir marca só o verde por padrão', () => {
    const verde = item({ ml_item_id: 'V', preco_sugerido: 85, preco_min: 70, preco_max: 90, projecao: [cor({ custo: 5, piso: 10 })] });
    const vermelho = item({ ml_item_id: 'R', preco_sugerido: 5, preco_min: 70, preco_max: 90, projecao: [cor({ custo: 5, piso: 10 })] });
    renderPreview({ itens: [verde, vermelho] });
    expect(screen.getByLabelText('Selecionar V')).toBeChecked();
    expect(screen.getByLabelText('Selecionar R')).not.toBeChecked();
  });

  it('digitar preço fora da faixa desabilita Executar', async () => {
    const user = userEvent.setup();
    const verde = item({ ml_item_id: 'V', preco_sugerido: 10, preco_min: 7, preco_max: 18.99, projecao: [cor({ custo: 5, piso: 8 })] });
    renderPreview({ itens: [verde] });

    expect(screen.getByRole('button', { name: 'Executar' })).not.toBeDisabled();

    const input = screen.getByLabelText('Preço de V');
    await user.clear(input);
    await user.type(input, '19,50');

    expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();
  });

  it('item vermelho marcado exige o checkbox de risco para habilitar Executar', async () => {
    const user = userEvent.setup();
    const vermelho = item({ ml_item_id: 'R', preco_sugerido: 5, preco_min: 1, preco_max: 90, projecao: [cor({ custo: 5, piso: 10 })] });
    renderPreview({ itens: [vermelho] });

    await user.click(screen.getByLabelText('Selecionar R'));
    expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();

    await user.click(screen.getByLabelText('Aderir mesmo assim'));
    expect(screen.getByRole('button', { name: 'Executar' })).not.toBeDisabled();
  });

  it('não admin não vê o botão Executar', () => {
    vi.mocked(usePodeExecutarOperacao).mockReturnValue(false);
    renderPreview({ itens: [item()] });
    expect(screen.queryByRole('button', { name: 'Executar' })).not.toBeInTheDocument();
    expect(screen.getByText('Só administradores executam operações em massa.')).toBeInTheDocument();
  });

  it('Executar chama a mutation com {acao, promocao_id, itens}', async () => {
    const user = userEvent.setup();
    const verde = item({ ml_item_id: 'V', preco_sugerido: 10, preco_min: 7, preco_max: 18.99, projecao: [cor({ custo: 5, piso: 8 })] });
    renderPreview({ itens: [verde], promocaoId: 'P9' });

    await user.click(screen.getByRole('button', { name: 'Executar' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      acao: 'aderir', promocao_id: 'P9', origem_id: null,
      itens: [{ ml_item_id: 'V', preco: 10, confirmado_risco: false }],
    });
    expect(toast.success).toHaveBeenCalledWith('Operação iniciada: 1 anúncios');
  });
});
