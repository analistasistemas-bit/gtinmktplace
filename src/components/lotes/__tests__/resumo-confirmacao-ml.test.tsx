import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ResumoConfirmacaoMl } from '@/components/lotes/resumo-confirmacao-ml';
import type { ConfirmacaoMl } from '@/lib/confirmacao-ml';

const m = vi.hoisted(() => ({
  linhas: [] as unknown[],
  familias: [] as Array<{ id: string; status: string }>,
}));
vi.mock('@/hooks/useConfirmacoesMl', () => ({
  useConfirmacoesMl: () => ({ data: m.linhas }),
}));
vi.mock('@/hooks/useFamilias', () => ({ useFamiliasResumo: () => ({ data: m.familias }) }));

const linha = (familia: string, status: string, over: Partial<ConfirmacaoMl> = {}): ConfirmacaoMl => ({
  id: familia, familia_id: familia, codigo_pai: '000', item_externo_id: 'MLB1', status,
  divergentes: [], capados: 0, enviado_em: new Date().toISOString(), ...over,
});

beforeEach(() => { m.linhas = []; m.familias = []; });

describe('ResumoConfirmacaoMl (ADR-0195)', () => {
  it('lote sem linhas não renderiza nada, mesmo com famílias publicadas', () => {
    m.familias = [{ id: 'a', status: 'publicado' }];
    const { container } = render(<ResumoConfirmacaoMl loteId="lote-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('3 confirmadas e 1 falha: contagem e tabela com enviado e observado', () => {
    m.linhas = [
      linha('a', 'confirmado'), linha('b', 'confirmado'), linha('c', 'confirmado'),
      linha('d', 'falhou', { divergentes: [
        { sku: 'SKU-1', enviado: 10, observado: 7 },
        { sku: 'SKU-2', enviado: 5, observado: null },
      ] }),
    ];
    render(<ResumoConfirmacaoMl loteId="lote-1" />);
    expect(screen.getByText('3 confirmadas no Mercado Livre')).toBeInTheDocument();
    expect(screen.getByText('1 com falha')).toHaveClass('text-destructive');
    const tabela = screen.getByRole('table');
    for (const coluna of ['SKU', 'Enviado', 'No ML']) {
      expect(within(tabela).getByRole('columnheader', { name: coluna })).toBeInTheDocument();
    }
    expect(within(tabela).getByRole('row', { name: 'SKU-1 10 7' })).toBeInTheDocument();
    expect(within(tabela).getByRole('row', { name: 'SKU-2 5 sem leitura' })).toBeInTheDocument();
  });

  it('sem falha não mostra tabela', () => {
    m.linhas = [linha('a', 'confirmado')];
    render(<ResumoConfirmacaoMl loteId="lote-1" />);
    expect(screen.getByText('1 confirmada no Mercado Livre')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('teto é aviso informativo, sem tom de erro', () => {
    m.linhas = [linha('a', 'confirmado', { capados: 61 })];
    render(<ResumoConfirmacaoMl loteId="lote-1" />);
    const aviso = screen.getByText('61 cor(es) limitadas pelo teto de 99.999');
    expect(aviso).toHaveClass('text-info');
    expect(aviso.className).not.toContain('destructive');
  });

  it('aguardando velho aparece como inconclusiva', () => {
    m.linhas = [linha('a', 'aguardando', { enviado_em: new Date(Date.now() - 21 * 60 * 1000).toISOString() })];
    render(<ResumoConfirmacaoMl loteId="lote-1" />);
    expect(screen.getByText('1 inconclusiva')).toBeInTheDocument();
    expect(screen.queryByText(/aguardando/)).not.toBeInTheDocument();
  });

  it('família publicada sem linha aparece como sem conferência', () => {
    m.linhas = [linha('a', 'aguardando')];
    m.familias = [{ id: 'a', status: 'publicado' }, { id: 'b', status: 'publicado' }, { id: 'c', status: 'erro' }];
    render(<ResumoConfirmacaoMl loteId="lote-1" />);
    expect(screen.getByText('1 aguardando')).toBeInTheDocument();
    expect(screen.getByText('1 sem conferência')).toBeInTheDocument();
  });
});
