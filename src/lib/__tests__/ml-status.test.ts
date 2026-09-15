import { describe, it, expect } from 'vitest';
import { urlVendaML } from '@/lib/ml-status';

describe('urlVendaML', () => {
  it('abre o detalhe da venda por order_id', () => {
    expect(urlVendaML('2000018464287084'))
      .toBe('https://www.mercadolivre.com.br/vendas/2000018464287084/detalhe');
  });

  // Regressão: `/vendas/pacote/{id}/detalhe` devolve 301 para `/vendas/lista` no ML (medido em
  // 15/09/2026 com id real e com id inventado). Pack também tem que abrir pela rota de order.
  it('nunca usa a rota de pacote, que o ML descontinuou', () => {
    expect(urlVendaML('900099')).not.toContain('/vendas/pacote/');
  });
});
