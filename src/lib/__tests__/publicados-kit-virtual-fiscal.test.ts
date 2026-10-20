import { describe, it, expect } from 'vitest';
import { fiscalDoKitVirtual } from '../publicados';

// A8 (auditoria fiscal 19/10): o kit virtual herda a prontidão fiscal dos componentes.
const prod = (canInvoice: boolean | null, canInvoiceCausa: string | null = null) => ({ canInvoice, canInvoiceCausa });

describe('fiscalDoKitVirtual', () => {
  it('todos prontos → true', () => {
    const m = new Map([['A', prod(true)], ['B', prod(true)]]);
    expect(fiscalDoKitVirtual(['A', 'B'], m)).toEqual({ canInvoice: true, canInvoiceCausa: null });
  });

  it('algum false → false com a causa dele (false vence null)', () => {
    const m = new Map([['A', prod(null)], ['B', prod(false, 'NCM recusado')], ['C', prod(true)]]);
    expect(fiscalDoKitVirtual(['A', 'B', 'C'], m)).toEqual({ canInvoice: false, canInvoiceCausa: 'NCM recusado' });
  });

  it('sem false e algum null → null', () => {
    const m = new Map([['A', prod(true)], ['B', prod(null)]]);
    expect(fiscalDoKitVirtual(['A', 'B'], m).canInvoice).toBeNull();
  });

  it('componente sem produto no catálogo (ou sem codigo_pai) → false, fora do catálogo', () => {
    const m = new Map([['A', prod(true)]]);
    expect(fiscalDoKitVirtual(['A', 'X'], m)).toEqual({ canInvoice: false, canInvoiceCausa: 'componente fora do catálogo (X)' });
    expect(fiscalDoKitVirtual(['A', null], m).canInvoice).toBe(false);
  });
});
