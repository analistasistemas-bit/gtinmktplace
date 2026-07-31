import { describe, it, expect } from 'vitest';
import { labelTipoDevolucao } from '@/lib/devolucoes';

describe('labelTipoDevolucao', () => {
  // A API de claims do ML manda 'returns' (plural) para devolução de verdade — 'return'
  // (singular) nunca ocorre. Sem essa chave certa, toda devolução real mostrava a string
  // crua 'returns' na aba Devoluções em vez de "Devolução".
  it('mapeia returns (plural, o que a API realmente manda) para Devolução', () => {
    expect(labelTipoDevolucao('returns')).toBe('Devolução');
  });

  it('mapeia os demais tipos conhecidos', () => {
    expect(labelTipoDevolucao('mediations')).toBe('Mediação');
    expect(labelTipoDevolucao('cancel_purchase')).toBe('Cancelamento (compra)');
    expect(labelTipoDevolucao('cancel_sale')).toBe('Cancelamento (venda)');
    expect(labelTipoDevolucao('ml_case')).toBe('Reclamação');
    expect(labelTipoDevolucao('fulfillment')).toBe('Fulfillment');
  });

  it('tipo desconhecido → mostra a string crua (fallback); null → travessão', () => {
    expect(labelTipoDevolucao('algo_novo_do_ml')).toBe('algo_novo_do_ml');
    expect(labelTipoDevolucao(null)).toBe('—');
  });
});
