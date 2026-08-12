// Campo EAN/GTIN editável na Revisão (lote #46: planilha de importado trouxe o código do
// fornecedor na coluna GTIN e o ML recusou a publicação inteira). O que estes testes travam:
//   - GTIN com dígito verificador errado é sinalizado ANTES de publicar;
//   - apagar o campo salva `null` — é assim que o anúncio sai como "sem código universal".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VariacaoCard } from '../variacao-card';
import type { Variacao } from '@/lib/tipos-dominio';

vi.mock('@/hooks/useImageUrl', () => ({
  useImageUrl: () => ({ data: null }),
  invalidarImagem: vi.fn(),
}));
vi.mock('@/components/semaforo-preco', () => ({ SemaforoPreco: () => null }));

const variacao: Variacao = {
  id: 'v1', codigo: '92710170', cor: 'Natal', corHex: '#ccc', corOrigem: 'descricao',
  corEditadaPeloOperador: false, preco: 78.9, precoPublicacao: null, precoPublicadoMl: null,
  estoque: 10, gtin: '48251671', excluidaDaPublicacao: false, mlVariationId: null,
  estoqueAnterior: null, custo: 40, pesoGramas: 100, alturaCm: 1, larguraCm: 1, comprimentoCm: 1,
  exibirComDesconto: null, descontoPct: null, atacado: null,
};

function renderCard(props: Partial<React.ComponentProps<typeof VariacaoCard>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
    <VariacaoCard
      variacao={variacao}
      loteId="lote-1"
      onMudarPreco={vi.fn()}
      onMudarCor={vi.fn()}
      categoriaMlId="MLB270273"
      aliquotaPct={16}
      {...props}
    />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('VariacaoCard — campo EAN/GTIN', () => {
  it('avisa quando o EAN tem dígito verificador errado', () => {
    renderCard();
    expect(screen.getByText(/EAN inválido/i)).toBeInTheDocument();
  });

  it('EAN com dígito verificador correto não dispara aviso', () => {
    renderCard({ variacao: { ...variacao, gtin: '7891234567895' } });
    expect(screen.queryByText(/EAN inválido/i)).not.toBeInTheDocument();
  });

  it('apagar o campo salva null (publica como "sem código universal")', async () => {
    const onSalvarGtin = vi.fn();
    renderCard({ onSalvarGtin });
    const input = screen.getByLabelText(/GTIN da variação/i);
    await userEvent.clear(input);
    await userEvent.tab();
    expect(onSalvarGtin).toHaveBeenCalledWith('92710170', null);
  });

  it('digitar um EAN válido salva o valor no blur', async () => {
    const onSalvarGtin = vi.fn();
    renderCard({ onSalvarGtin });
    const input = screen.getByLabelText(/GTIN da variação/i);
    await userEvent.clear(input);
    await userEvent.type(input, '7891234567895');
    await userEvent.tab();
    expect(onSalvarGtin).toHaveBeenCalledWith('92710170', '7891234567895');
  });
});
