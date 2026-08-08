import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ViabilidadeLinha } from '@/components/viabilidade-linha';
import type { ItemAnalisado } from '@/lib/viabilidade';

vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 8, importado: 16 } }),
}));
// T6: a linha passou a ler o módulo 'estoque' (gate do botão Cadastrar) e a usar useNavigate —
// daí o mock do hook e o MemoryRouter. O botão nunca aparece nesta suíte (`editavel={false}`).
vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => ({ data: ['estoque'] }),
}));

function renderLinha(item: ItemAnalisado) {
  return render(
    <MemoryRouter>
      <table><tbody><ViabilidadeLinha item={item} editavel={false} /></tbody></table>
    </MemoryRouter>,
  );
}

const base: ItemAnalisado = {
  gtin: '4005800241901', nome: 'Produto teste', unidade: null,
  minimo: 20, custo: 10, origem: 'nacional', existeNoML: true,
  mercado: { menor: 84.99, maior: 168.9, vendedores: 3, freteGratis: 4, full: 0 },
  classico: { saleFeeAmount: 11.9, percentual: 14, fixa: 0 },
  premium: { saleFeeAmount: 16.15, percentual: 19, fixa: 0 },
  dimensoesEncontradas: true,
};

describe('ViabilidadeLinha — legenda de frete (mesma da Revisão)', () => {
  it('com frete > 0, explica que já desconta o frete grátis do comprador', () => {
    renderLinha({ ...base, frete: 12.35 });
    fireEvent.click(screen.getByText('Produto teste'));
    const legenda = screen.getByText(/já desconta o frete grátis ao comprador por sua conta/i);
    expect(legenda.closest('p')).toHaveTextContent('−R$ 12,35');
  });

  it('com frete = 0, explica a faixa de frete grátis acima de R$19', () => {
    renderLinha({ ...base, frete: 0 });
    fireEvent.click(screen.getByText('Produto teste'));
    expect(screen.getByText(/acima de r\$19.*frete grátis/i)).toBeInTheDocument();
  });
});
