import { describe, expect, it, vi } from 'vitest';
import { reconciliarCanInvoice } from '../can-invoice.ts';

// Fake admin: organizations (gate) + familias (leitura/escrita). listarItensUP é injetado por
// parâmetro na maioria dos casos (mais simples que fakear anuncios_externos/*_itens aqui — essa
// query real já tem cobertura direta em _shared/fiscal/__tests__/can-invoice.test.ts).
function fakeAdmin(opts: {
  modulos?: string[];
  orgErro?: string;
  familias?: Array<{ id: string; codigo_pai: string; ml_item_id: string | null }>;
  familiasErro?: string;
}) {
  const updates: Array<{ id: string; can_invoice: boolean; can_invoice_causa: string | null }> = [];
  const admin = {
    from: (t: string) => {
      if (t === 'organizations') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () =>
            opts.orgErro
              ? { data: null, error: { message: opts.orgErro } }
              : { data: { modulos_habilitados: opts.modulos ?? ['fiscal'] }, error: null } }) }),
        };
      }
      if (t === 'familias') {
        return {
          select: () => ({ eq: () => ({ not: () => ({ eq: async () =>
            opts.familiasErro
              ? { data: null, error: { message: opts.familiasErro } }
              : { data: opts.familias ?? [], error: null } }) }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => {
              updates.push({
                id, can_invoice: patch.can_invoice as boolean,
                can_invoice_causa: patch.can_invoice_causa as string | null,
              });
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`tabela não mapeada no fake: ${t}`);
    },
  };
  return { admin: admin as never, updates };
}

describe('reconciliarCanInvoice (ADR-0135 D-10 — o estado exibido é o do ML)', () => {
  it('org sem módulo fiscal → 0, não faz trabalho nenhum', async () => {
    const { admin } = fakeAdmin({ modulos: [] });
    const n = await reconciliarCanInvoice(admin, 'o1', 'tok', vi.fn(), vi.fn(async () => []));
    expect(n).toBe(0);
  });

  it('erro ao ler organizations propaga (nunca silencia como "sem módulo")', async () => {
    const { admin } = fakeAdmin({ orgErro: 'timeout' });
    await expect(reconciliarCanInvoice(admin, 'o1', 'tok', vi.fn(), vi.fn())).rejects.toThrow(/timeout/);
  });

  it('erro ao ler familias propaga — nunca degrada pra lista vazia', async () => {
    const { admin } = fakeAdmin({ familiasErro: 'timeout' });
    await expect(reconciliarCanInvoice(admin, 'o1', 'tok', vi.fn(), vi.fn())).rejects.toThrow(/timeout/);
  });

  it('família Legacy (sem filhos UP): grava can_invoice por familias.ml_item_id', async () => {
    const { admin, updates } = fakeAdmin({
      familias: [
        { id: 'f1', codigo_pai: 'CP1', ml_item_id: 'MLB1' },
        { id: 'f2', codigo_pai: 'CP2', ml_item_id: 'MLB2' },
      ],
    });
    const listarItensUP = vi.fn(async () => []); // [] = Legacy, como sincronizar-fiscal-ml
    const ler = vi.fn(async (_t: string, itemId: string) =>
      ({ pronto: itemId === 'MLB1', causa: itemId === 'MLB1' ? null : '{"status":false}' }));
    const n = await reconciliarCanInvoice(admin, 'o1', 'tok', ler, listarItensUP);
    expect(n).toBe(2);
    expect(updates.find((u) => u.id === 'f1')).toEqual({ id: 'f1', can_invoice: true, can_invoice_causa: null });
    expect(updates.find((u) => u.id === 'f2')).toEqual({ id: 'f2', can_invoice: false, can_invoice_causa: '{"status":false}' });
  });

  it('família User Products: lê can_invoice de CADA item por SKU, AND, causa cita o item', async () => {
    const { admin, updates } = fakeAdmin({
      familias: [{ id: 'f1', codigo_pai: 'CP1', ml_item_id: 'MLB1' }], // ml_item_id = só o 1º item da partição 0
    });
    const listarItensUP = vi.fn(async () => [
      { sku: 'S1', item_externo_id: 'MLB1' },
      { sku: 'S2', item_externo_id: 'MLB2' },
    ]);
    const ler = vi.fn(async (_t: string, itemId: string) =>
      ({ pronto: itemId === 'MLB1', causa: itemId === 'MLB1' ? null : 'motivo-ml' }));
    const n = await reconciliarCanInvoice(admin, 'o1', 'tok', ler, listarItensUP);
    expect(n).toBe(1);
    expect(ler).toHaveBeenCalledWith('tok', 'MLB1');
    expect(ler).toHaveBeenCalledWith('tok', 'MLB2');
    expect(updates[0]).toEqual({ id: 'f1', can_invoice: false, can_invoice_causa: 'item MLB2: motivo-ml' });
  });

  it('SKU órfão (item_externo_id null) na rota UP fica fora do AND — não derruba nem afirma sozinho', async () => {
    const { admin, updates } = fakeAdmin({
      familias: [{ id: 'f1', codigo_pai: 'CP1', ml_item_id: 'MLB1' }],
    });
    const listarItensUP = vi.fn(async () => [
      { sku: 'S1', item_externo_id: 'MLB1' },
      { sku: 'S2', item_externo_id: null }, // ainda pendente no ML
    ]);
    const ler = vi.fn(async () => ({ pronto: true, causa: null }));
    const n = await reconciliarCanInvoice(admin, 'o1', 'tok', ler, listarItensUP);
    expect(n).toBe(1);
    expect(ler).toHaveBeenCalledTimes(1);
    expect(ler).toHaveBeenCalledWith('tok', 'MLB1');
    expect(updates[0].can_invoice).toBe(true);
  });

  it('falha de leitura do ML (lerCanInvoice → null) NÃO regride o estado gravado', async () => {
    const { admin, updates } = fakeAdmin({
      familias: [{ id: 'f1', codigo_pai: 'CP1', ml_item_id: 'MLB1' }],
    });
    const listarItensUP = vi.fn(async () => []);
    const ler = vi.fn(async () => null);
    const n = await reconciliarCanInvoice(admin, 'o1', 'tok', ler, listarItensUP);
    expect(n).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('erro de leitura do banco ao resolver itens UP propaga (não vira decisão silenciosa)', async () => {
    const { admin } = fakeAdmin({
      familias: [{ id: 'f1', codigo_pai: 'CP1', ml_item_id: 'MLB1' }],
    });
    const listarItensUP = vi.fn(async () => { throw new Error('timeout'); });
    await expect(reconciliarCanInvoice(admin, 'o1', 'tok', vi.fn(), listarItensUP)).rejects.toThrow(/timeout/);
  });
});
