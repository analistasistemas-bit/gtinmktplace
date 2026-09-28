// ⚠ "Sem cor identificada — revise" só faz sentido quando a família exige cor. Produto simples
// (CREATE, tipo 'outro', 1 variação — familiaExigeCor=false) publica como "Único" e o alerta
// fazia a variação parecer com erro (condicionador HairFly, família 00000001).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VariacaoCard } from '../variacao-card';
import type { Variacao } from '@/lib/tipos-dominio';

vi.mock('@/hooks/useImageUrl', () => ({
  useImageUrl: () => ({ data: null }),
  invalidarImagem: vi.fn(),
}));
vi.mock('@/components/semaforo-preco', () => ({ SemaforoPreco: () => null }));

const semCor: Variacao = {
  id: 'v1', codigo: '00000002', cor: '', tamanho: null, corHex: '#ccc', corOrigem: null,
  corEditadaPeloOperador: false, preco: 28.5, precoPublicacao: null, precoPublicadoMl: null,
  estoque: 10, gtin: null, excluidaDaPublicacao: false, mlVariationId: null,
  estoqueAnterior: null, custo: 3.65, pesoGramas: 900, alturaCm: 1, larguraCm: 1, comprimentoCm: 1,
  atacado: null,
};

function renderCard(props: Partial<React.ComponentProps<typeof VariacaoCard>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VariacaoCard
        variacao={semCor}
        loteId="lote-1"
        onMudarPreco={vi.fn()}
        onMudarCor={vi.fn()}
        categoriaMlId="MLB1265"
        aliquotaPct={8}
        {...props}
      />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('VariacaoCard — alerta "sem cor"', () => {
  it('família que exige cor: variação sem cor com estoque mostra o alerta', () => {
    renderCard();
    expect(screen.getByText(/Sem cor identificada/i)).toBeInTheDocument();
  });

  it('produto simples (exigeCor=false): sem alerta', () => {
    renderCard({ exigeCor: false });
    expect(screen.queryByText(/Sem cor identificada/i)).not.toBeInTheDocument();
  });
});
