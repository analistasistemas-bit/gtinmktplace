import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DialogReprecificar } from '../dialog-reprecificar';
import { fetchContextoMargem } from '@/lib/pulse';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@/lib/pulse', () => ({ fetchContextoMargem: vi.fn() }));

function renderDialog(custos: Parameters<typeof DialogReprecificar>[0]['custos']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DialogReprecificar
        codigoPai="APTAMIL-1"
        precoInicial={100}
        custos={custos}
        onFechar={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

// ADR-0150 D-1: mesma base (liquido/preco) das outras duas telas — só o rótulo estava faltando.
describe('DialogReprecificar — o percentual da margem diz o denominador', () => {
  it('mostra "s/ venda" junto do percentual, com o mesmo número de antes', async () => {
    vi.mocked(fetchContextoMargem).mockResolvedValue({ custo: 30, aliquotaPct: 8 });
    // 100 − 14 (comissão) − 5 (frete) − 8 (imposto 8%) − 30 (custo) = 43,00 → 43,0%
    renderDialog({ comissaoPct: 14, comissaoFixa: 0, comissaoPreco: 100, frete: 5 });

    expect(await screen.findByText(/43\.0%\s*s\/\s*venda/)).toBeInTheDocument();
  });
});
