import { describe, expect, it, vi } from 'vitest';
import { processarSincronizacaoFiscal } from '../processar.ts';

const familia = {
  id: 'f1', org_id: 'o1', nome_pai: 'X', ml_item_id: 'MLB1', unidade: 'UN',
  origem: 'nacional', ncm: '39269090', cest: null, origem_nfe: 0, fci: null,
  ex_tipi: null, tributacao_icms: '102', tributacao_icms_regime: 'simples',
};
const variacoes = [{ codigo: '00101', gtin: '7891234567895', peso_gramas: 200, ml_variation_id: 'v1' }];

function deps(opts: { modulosHabilitados?: string[] } = {}) {
  const modulosHabilitados = opts.modulosHabilitados ?? ['fiscal'];
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from: (t: string) => ({
      select: () => ({
        eq: (_c: string, _v: string) => ({
          single: async () => ({ data: t === 'familias' ? familia : null }),
          maybeSingle: async () => ({
            data: t === 'organizations' ? { modulos_habilitados: modulosHabilitados }
              : t === 'empresa_fiscal' ? { origin_type: 'reseller', regime_tributario: 'simples' }
              : null,
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null }; } }),
    }),
  };
  return {
    admin: admin as never,
    resolverConexao: vi.fn(async () => ({ id: 'cx1' })),
    getToken: vi.fn(async () => 'tok'),
    listarVariacoes: vi.fn(async () => variacoes),
    portas: {
      empurrarFiscalSku: vi.fn(async () => {}),
      vincularSkuAnuncio: vi.fn(async () => {}),
      lerCanInvoice: vi.fn(async () => ({ pronto: true, causa: null })),
    },
    updates,
  };
}

describe('processarSincronizacaoFiscal (ADR-0135 D-1/D-10)', () => {
  it('caminho feliz: empurra cada SKU, vincula, lê can_invoice e persiste', async () => {
    const d = deps();
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    expect(d.portas.empurrarFiscalSku).toHaveBeenCalledTimes(1);
    expect(d.portas.vincularSkuAnuncio).toHaveBeenCalledWith('tok', {
      sku: '00101', item_id: 'MLB1', variation_id: 'v1',
    });
    expect(d.updates.some((u) => u.can_invoice === true)).toBe(true);
  });

  it('org sem módulo: skip 200 sem tocar o ML', async () => {
    const d = deps({ modulosHabilitados: [] });
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    expect(d.portas.empurrarFiscalSku).not.toHaveBeenCalled();
  });

  it('4xx do ML: definitivo — 200 com can_invoice=false + causa, sem retry', async () => {
    const d = deps();
    const e = Object.assign(new Error('bad request'), { status: 400 });
    (d.portas.empurrarFiscalSku as ReturnType<typeof vi.fn>).mockRejectedValue(e);
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    expect(d.updates.some((u) => u.can_invoice === false)).toBe(true);
  });

  it('5xx/timeout do ML: transitório — status 500 para o QStash retentar', async () => {
    const d = deps();
    const e = Object.assign(new Error('gateway'), { status: 502 });
    (d.portas.empurrarFiscalSku as ReturnType<typeof vi.fn>).mockRejectedValue(e);
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(500);
  });

  it('replay: segunda chamada com mesmo job repete upsert sem efeito colateral novo (idempotente)', async () => {
    const d = deps();
    await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(d.portas.empurrarFiscalSku).toHaveBeenCalledTimes(2); // PUT-upsert: replay é inofensivo
  });
});
