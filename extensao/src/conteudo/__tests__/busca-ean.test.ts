import { describe, expect, it } from 'vitest';
import { eanDaUrlDeBusca } from '../ean';

describe('eanDaUrlDeBusca', () => {
  it('EAN-13 válido no primeiro segmento', () => {
    expect(eanDaUrlDeBusca('https://lista.mercadolivre.com.br/7899941205918')).toBe('7899941205918');
    expect(eanDaUrlDeBusca('https://lista.mercadolivre.com.br/7899941205918_NoIndex_True?x=1')).toBe('7899941205918');
  });
  it('EAN-8 e UPC-12 válidos', () => {
    expect(eanDaUrlDeBusca('https://lista.mercadolivre.com.br/96385074')).toBe('96385074');
    expect(eanDaUrlDeBusca('https://lista.mercadolivre.com.br/036000291452')).toBe('036000291452');
  });
  it('termo textual, checksum inválido, tamanho errado, outro host ou URL inválida → null', () => {
    expect(eanDaUrlDeBusca('https://lista.mercadolivre.com.br/tenis-nike')).toBeNull();
    expect(eanDaUrlDeBusca('https://lista.mercadolivre.com.br/7899941205917')).toBeNull();
    expect(eanDaUrlDeBusca('https://lista.mercadolivre.com.br/123456789')).toBeNull();
    expect(eanDaUrlDeBusca('https://www.mercadolivre.com.br/7899941205918')).toBeNull();
    expect(eanDaUrlDeBusca('não é url')).toBeNull();
  });
});
