import { describe, it, expect } from 'vitest';
import { urlConversaML } from '@/lib/ml-status';

describe('urlConversaML', () => {
  it('pedido solo (pack_id === order_id) abre o detalhe por order', () => {
    expect(urlConversaML('2000012345', '2000012345'))
      .toBe('https://www.mercadolivre.com.br/vendas/2000012345/detalhe');
  });

  it('pack de verdade abre o detalhe do pacote', () => {
    expect(urlConversaML('900099', '2000012345'))
      .toBe('https://www.mercadolivre.com.br/vendas/pacote/900099/detalhe');
  });

  it('sem order_id resolvido, cai no pacote', () => {
    expect(urlConversaML('900099', null))
      .toBe('https://www.mercadolivre.com.br/vendas/pacote/900099/detalhe');
  });
});
