import { describe, it, expect } from 'vitest';
import { dedupePublicados, fiscalDoKitVirtual, type PublicadoItem } from '../publicados';

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

// M3 (auditoria fiscal 19/10): a causa mostrada é a da versão `false` que pôs o semáforo em Pendente.
describe('dedupePublicados — causa da pendência fiscal', () => {
  const item = (over: Partial<PublicadoItem>): PublicadoItem => ({
    familiaId: 'f', codigoPai: 'P', gtin: null, titulo: 'T', fornecedor: null, tipo: null, categoria: null,
    precoPublicacao: 1, precoPublicacaoMax: 1, descricao: null, mlItemId: 'MLB1', mlPermalink: null,
    publicadoEm: '2026-01-01', ...over,
  });

  it('propaga a causa da primeira versão no ar com canInvoice=false', () => {
    const [r] = dedupePublicados([
      item({ familiaId: 'a', publicadoEm: '2026-01-01', canInvoice: true, canInvoiceCausa: null }),
      item({ familiaId: 'b', publicadoEm: '2026-02-01', canInvoice: false, canInvoiceCausa: 'NCM recusado' }),
    ]);
    expect(r.canInvoice).toBe(false);
    expect(r.canInvoiceCausa).toBe('NCM recusado');
  });

  it('sem pendência → sem causa', () => {
    const [r] = dedupePublicados([item({ canInvoice: true, canInvoiceCausa: 'velha' })]);
    expect(r.canInvoiceCausa).toBeNull();
  });
});
