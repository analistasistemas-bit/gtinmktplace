import { describe, expect, it, vi } from 'vitest';
import { processarSincronizacaoFiscal } from '../processar.ts';

const familia = {
  id: 'f1', org_id: 'o1', codigo_pai: 'CP1', nome_pai: 'X', ml_item_id: 'MLB1', unidade: 'UN',
  origem: 'nacional', ncm: '39269090', cest: null, origem_nfe: 0, fci: null,
  ex_tipi: null, tributacao_icms: '102', tributacao_icms_regime: 'simples',
};
const variacoes = [{ codigo: '00101', gtin: '7891234567895', peso_gramas: 200, ml_variation_id: 'v1' }];
const EMPRESA_OK = { origin_type: 'reseller', regime_tributario: 'simples' };

function deps(opts: {
  modulosHabilitados?: string[];
  familiaOverride?: Record<string, unknown>;
  empresaOverride?: Record<string, unknown> | null;
  itensUP?: Array<{ sku: string; item_externo_id: string | null }>;
  variacoesOverride?: typeof variacoes;
  orgErro?: string;
  empresaErro?: string;
} = {}) {
  const modulosHabilitados = opts.modulosHabilitados ?? ['fiscal'];
  const familiaUsada = { ...familia, ...opts.familiaOverride };
  const empresaUsada = opts.empresaOverride === undefined ? EMPRESA_OK : opts.empresaOverride;
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from: (t: string) => ({
      select: () => ({
        eq: (_c: string, _v: string) => ({
          single: async () => ({ data: t === 'familias' ? familiaUsada : null }),
          maybeSingle: async () => {
            if (t === 'organizations' && opts.orgErro) return { data: null, error: { message: opts.orgErro } };
            if (t === 'empresa_fiscal' && opts.empresaErro) return { data: null, error: { message: opts.empresaErro } };
            return {
              data: t === 'organizations' ? { modulos_habilitados: modulosHabilitados }
                : t === 'empresa_fiscal' ? empresaUsada
                : null,
              error: null,
            };
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null }; } }),
    }),
  };
  return {
    admin: admin as never,
    resolverConexao: vi.fn(async () => ({ id: 'cx1' })),
    getToken: vi.fn(async () => 'tok'),
    listarVariacoes: vi.fn(async () => opts.variacoesOverride ?? variacoes),
    listarItensUP: vi.fn(async () => opts.itensUP ?? []),
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

  it('fix round 1: família sem ncm — 200 definitivo, can_invoice=false gravado, portas NUNCA chamadas', async () => {
    const d = deps({ familiaOverride: { ncm: null } });
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    expect(d.updates.some((u) => u.can_invoice === false)).toBe(true);
    expect(d.portas.empurrarFiscalSku).not.toHaveBeenCalled();
    expect(d.portas.vincularSkuAnuncio).not.toHaveBeenCalled();
    expect(d.portas.lerCanInvoice).not.toHaveBeenCalled();
    expect(d.resolverConexao).not.toHaveBeenCalled();
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

  it('replay: leitura falha (null) no can_invoice NÃO regride um true já gravado (I7)', async () => {
    const d = deps();
    await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' }); // run 1: lerCanInvoice → {pronto:true}
    expect(d.updates.some((u) => u.can_invoice === true)).toBe(true);
    d.updates.length = 0; // isola o que o run 2 grava
    (d.portas.lerCanInvoice as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' }); // run 2: leitura falha
    expect(d.updates.some((u) => 'can_invoice' in u)).toBe(false); // nenhum update do semáforo
    expect(d.portas.empurrarFiscalSku).toHaveBeenCalledTimes(2); // push em si continua idempotente (upsert)
  });

  it('fix round 2 (C1): rota UP vincula cada SKU ao SEU item, não ao ml_item_id genérico', async () => {
    const d = deps({
      itensUP: [{ sku: 'V1', item_externo_id: 'MLB-V1' }, { sku: 'V2', item_externo_id: 'MLB-V2' }],
      variacoesOverride: [
        { codigo: 'V1', gtin: null, peso_gramas: 100, ml_variation_id: null },
        { codigo: 'V2', gtin: null, peso_gramas: 100, ml_variation_id: null },
      ],
    });
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    expect(d.portas.vincularSkuAnuncio).toHaveBeenCalledWith('tok', { sku: 'V1', item_id: 'MLB-V1' });
    expect(d.portas.vincularSkuAnuncio).toHaveBeenCalledWith('tok', { sku: 'V2', item_id: 'MLB-V2' });
    expect(d.portas.lerCanInvoice).toHaveBeenCalledWith('tok', 'MLB-V1');
    expect(d.portas.lerCanInvoice).toHaveBeenCalledWith('tok', 'MLB-V2');
  });

  it('fix round 2 (C1): semáforo UP é AND entre itens — 1 não-pronto derruba a família, causa cita o item', async () => {
    const d = deps({
      itensUP: [{ sku: 'V1', item_externo_id: 'MLB-V1' }, { sku: 'V2', item_externo_id: 'MLB-V2' }],
      variacoesOverride: [
        { codigo: 'V1', gtin: null, peso_gramas: 100, ml_variation_id: null },
        { codigo: 'V2', gtin: null, peso_gramas: 100, ml_variation_id: null },
      ],
    });
    (d.portas.lerCanInvoice as ReturnType<typeof vi.fn>).mockImplementation(async (_tok: string, itemId: string) =>
      itemId === 'MLB-V2' ? { pronto: false, causa: 'faltando X' } : { pronto: true, causa: null });
    await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    const upd = d.updates.find((u) => u.can_invoice === false);
    expect(upd).toBeDefined();
    expect(String(upd?.can_invoice_causa)).toContain('MLB-V2');
  });

  it('fix round 2 (C2): regime normal — recusa definitiva (v1 só Simples), portas nunca chamadas', async () => {
    const d = deps({ empresaOverride: { origin_type: 'reseller', regime_tributario: 'normal' } });
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    expect(d.updates.some((u) => u.can_invoice === false)).toBe(true);
    const causa = String(d.updates.find((u) => u.can_invoice === false)?.can_invoice_causa);
    expect(causa).toContain('Simples');
    expect(d.portas.empurrarFiscalSku).not.toHaveBeenCalled();
  });

  it('fix round 2 (I5): org sem cadastro em empresa_fiscal — recusa definitiva, não default pra simples', async () => {
    const d = deps({ empresaOverride: null });
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    expect(d.updates.some((u) => u.can_invoice === false)).toBe(true);
    expect(d.portas.empurrarFiscalSku).not.toHaveBeenCalled();
  });

  it('fix round 2 (I5): origin_type ausente em empresa_fiscal — recusa definitiva', async () => {
    const d = deps({ empresaOverride: { origin_type: null, regime_tributario: 'simples' } });
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    expect(d.updates.some((u) => u.can_invoice === false)).toBe(true);
    expect(d.portas.empurrarFiscalSku).not.toHaveBeenCalled();
  });

  it('fix round 3 (Q1): erro de leitura em listarItensUP — 500, nenhum update de can_invoice', async () => {
    const d = deps();
    (d.listarItensUP as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('listarItensUP (raízes): boom'));
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(500);
    expect(d.updates.some((u) => 'can_invoice' in u)).toBe(false);
    expect(d.portas.empurrarFiscalSku).not.toHaveBeenCalled();
  });

  it('fix round 3 (Q2): erro de leitura em empresa_fiscal — 500, nada gravado (não confunde com "sem cadastro")', async () => {
    const d = deps({ empresaErro: 'timeout' });
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(500);
    expect(d.updates.length).toBe(0);
    expect(d.portas.empurrarFiscalSku).not.toHaveBeenCalled();
  });

  it('fix round 3 (Q2): erro de leitura em organizations — 500, nada gravado', async () => {
    const d = deps({ orgErro: 'timeout' });
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(500);
    expect(d.updates.length).toBe(0);
    expect(d.portas.empurrarFiscalSku).not.toHaveBeenCalled();
  });

  it('fix round 3 (Q3): UP com 1 SKU sem item vinculado — can_invoice=false citando o SKU órfão, nunca true', async () => {
    const d = deps({
      itensUP: [{ sku: 'V1', item_externo_id: 'MLB-V1' }], // V2 não tem item resolvido ainda
      variacoesOverride: [
        { codigo: 'V1', gtin: null, peso_gramas: 100, ml_variation_id: null },
        { codigo: 'V2', gtin: null, peso_gramas: 100, ml_variation_id: null },
      ],
    });
    const r = await processarSincronizacaoFiscal(d as never, { familia_id: 'f1' });
    expect(r.status).toBe(200);
    // empurra fiscal dos SKUs resolvidos e do órfão também (payload não depende do item) — só o
    // vínculo e o semáforo são afetados.
    expect(d.portas.empurrarFiscalSku).toHaveBeenCalledTimes(2);
    expect(d.portas.vincularSkuAnuncio).toHaveBeenCalledTimes(1); // só V1, que tem item
    expect(d.updates.some((u) => u.can_invoice === true)).toBe(false);
    const upd = d.updates.find((u) => u.can_invoice === false);
    expect(upd).toBeDefined();
    expect(String(upd?.can_invoice_causa)).toContain('V2');
  });
});
