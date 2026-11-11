import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardFila } from '@/components/faturamento/posvenda/lista-reclamacoes';
import type { Devolucao } from '@/lib/devolucoes';

vi.mock('@/components/faturamento/pilha-thumbs', () => ({ ThumbProduto: () => null }));

const agora = new Date('2026-11-09T12:00:00Z');
const base = { claim_id: 1, order_id: null, type: 'mediations', status: 'opened', vez_de: 'vendedor' } as unknown as Devolucao;
const card = (d: Partial<Devolucao>) =>
  render(<CardFila d={{ ...base, ...d }} travas={[]} agora={agora} acaoPrimaria={() => null} />);

describe('CardFila - Atualizado', () => {
  it('mostra "Atualizado há 5 minutos" a partir de lido_em', () => {
    card({ lido_em: '2026-11-09T11:55:00Z', enriquecido_em: null });
    expect(screen.getByText('Atualizado há 5 minutos')).toBeInTheDocument();
  });
  it('lido_em depois de agora (lista montada antes da releitura) → "agora há pouco"', () => {
    card({ lido_em: '2026-11-09T12:03:00Z', enriquecido_em: null });
    expect(screen.getByText('Atualizado agora há pouco')).toBeInTheDocument();
  });
  it('não mostra nada sem lido_em nem enriquecido_em', () => {
    card({ lido_em: null, enriquecido_em: null });
    expect(screen.queryByText(/Atualizado/)).toBeNull();
  });
});
