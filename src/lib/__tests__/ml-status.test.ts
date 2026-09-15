import { describe, it, expect } from 'vitest';
import { urlVendaML } from '@/lib/ml-status';

describe('urlVendaML', () => {
  it('abre o detalhe da venda pelo id recebido', () => {
    expect(urlVendaML('2000015036699189'))
      .toBe('https://www.mercadolivre.com.br/vendas/2000015036699189/detalhe');
  });

  // Regressão: `/vendas/pacote/{id}/detalhe` devolve 301 para `/vendas/lista` no ML (medido em
  // 15/09/2026 com id real e inventado). A rota viva é a mesma para pack e para order.
  it('nunca usa a rota de pacote, que o ML descontinuou', () => {
    expect(urlVendaML(900099)).not.toContain('/vendas/pacote/');
  });
});
