import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TabelaRadar } from '../tabela-radar';
import type { PulseProduto, PulseResumoOfertas } from '@/lib/pulse';

const produto: PulseProduto = {
  id: 'produto-1', catalog_product_id: 'MLB123456', codigo_pai: 'APTAMIL-1800', titulo: 'Aptamil', gtin: null,
  origem: 'auto', status: 'ativo', catalogo_status: 'vinculado', ptw_status: null, ptw_preco_sugerido: null,
  ptw_aplicavel: null, ptw_custos: null, ultimo_snapshot_em: null, meu_preco: 81.99, meu_preco_em: null,
  anuncio_status: 'active', anuncio_sub_status: [], anuncio_status_em: null, comissao_pct: null,
  comissao_fixa: null, comissao_preco: null, comissao_em: null,
};

const resumo: PulseResumoOfertas = {
  menorPreco: 36, menorObservado: 36, menorRelevante: 70.19, nOfertas: 2, nOfertasRelevantes: 1,
};

describe('TabelaRadar — mercado relevante', () => {
  it('exibe o menor relevante, nunca o menor observado', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TabelaRadar produtos={[produto]} resumo={new Map([[produto.id, resumo]])} resumoCarregando={false} onAbrirDetalhe={() => undefined} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('columnheader', { name: 'Menor relevante' })).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*70,19/)).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s*36,00/)).not.toBeInTheDocument();
    expect(screen.getByText('+17% mais caro')).toBeInTheDocument();
  });
});
