import { describe, expect, it } from 'vitest';
import { calcularSemaforoCanInvoice, idsParaChecar, listarItensUP } from '../can-invoice.ts';

// Fake admin mínimo pra exercitar a query real de listarItensUP (Task 7 nunca testou
// diretamente essa implementação — só via vi.fn() injetado em DepsFiscal). Extraída pra shared
// na Task 8, ganha cobertura direta aqui.
function fakeAdmin(opts: {
  raizes?: Array<{ id: string }>;
  raizesErro?: string;
  itens?: Array<{ sku: string; item_externo_id: string | null }>;
  itensErro?: string;
}) {
  return {
    from: (t: string) => {
      if (t === 'anuncios_externos') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: async () =>
            opts.raizesErro ? { data: null, error: { message: opts.raizesErro } }
                              : { data: opts.raizes ?? [], error: null } }) }) }) }),
        };
      }
      if (t === 'anuncios_externos_itens') {
        return {
          select: () => ({ in: () => ({ eq: async () =>
            opts.itensErro ? { data: null, error: { message: opts.itensErro } }
                             : { data: opts.itens ?? [], error: null } }) }),
        };
      }
      throw new Error(`tabela não mapeada: ${t}`);
    },
  } as never;
}

describe('listarItensUP', () => {
  it('sem raiz na partição 0 → [] (família Legacy)', async () => {
    const admin = fakeAdmin({ raizes: [] });
    expect(await listarItensUP(admin, 'o1', 'CP1')).toEqual([]);
  });

  it('com raiz → devolve itens não-retirados dos filhos', async () => {
    const admin = fakeAdmin({
      raizes: [{ id: 'raiz1' }],
      itens: [{ sku: 'S1', item_externo_id: 'MLB1' }, { sku: 'S2', item_externo_id: null }],
    });
    expect(await listarItensUP(admin, 'o1', 'CP1')).toEqual([
      { sku: 'S1', item_externo_id: 'MLB1' }, { sku: 'S2', item_externo_id: null },
    ]);
  });

  it('erro ao ler raízes LANÇA — nunca degrada pra [] (Task 7, round 3, Q1)', async () => {
    const admin = fakeAdmin({ raizesErro: 'timeout' });
    await expect(listarItensUP(admin, 'o1', 'CP1')).rejects.toThrow(/timeout/);
  });

  it('erro ao ler itens dos filhos também LANÇA', async () => {
    const admin = fakeAdmin({ raizes: [{ id: 'raiz1' }], itensErro: 'timeout' });
    await expect(listarItensUP(admin, 'o1', 'CP1')).rejects.toThrow(/timeout/);
  });
});

describe('idsParaChecar', () => {
  it('Legacy (sem itens UP): usa ml_item_id se houver', () => {
    expect(idsParaChecar([], 'MLB1')).toEqual(['MLB1']);
    expect(idsParaChecar([], null)).toEqual([]);
  });

  it('UP: ids distintos, descarta SKU órfão (item_externo_id null)', () => {
    const itens = [
      { sku: 'S1', item_externo_id: 'I1' }, { sku: 'S2', item_externo_id: 'I1' },
      { sku: 'S3', item_externo_id: null },
    ];
    expect(idsParaChecar(itens, 'MLB-primeiro-item')).toEqual(['I1']);
  });
});

describe('calcularSemaforoCanInvoice', () => {
  it('[] de ids → null (nada a checar)', async () => {
    expect(await calcularSemaforoCanInvoice('tok', [], async () => ({ pronto: true, causa: null }), false)).toBeNull();
  });

  it('todos prontos → pronto=true, causa=null', async () => {
    const r = await calcularSemaforoCanInvoice('tok', ['I1', 'I2'], async () => ({ pronto: true, causa: null }), true);
    expect(r).toEqual({ pronto: true, causa: null });
  });

  it('AND: 1 item não-pronto derruba tudo, causa cita o item quando citarItem=true', async () => {
    const ler = async (_t: string, id: string) => ({ pronto: id === 'I1', causa: id === 'I1' ? null : 'motivo-ml' });
    const r = await calcularSemaforoCanInvoice('tok', ['I1', 'I2'], ler, true);
    expect(r).toEqual({ pronto: false, causa: 'item I2: motivo-ml' });
  });

  it('Legacy (citarItem=false): causa não leva prefixo', async () => {
    const r = await calcularSemaforoCanInvoice('tok', ['I1'], async () => ({ pronto: false, causa: 'motivo-ml' }), false);
    expect(r).toEqual({ pronto: false, causa: 'motivo-ml' });
  });

  it('qualquer leitura falhando (null) → null, nunca regride estado gravado (I7)', async () => {
    const ler = async (_t: string, id: string) => (id === 'I1' ? { pronto: true, causa: null } : null);
    expect(await calcularSemaforoCanInvoice('tok', ['I1', 'I2'], ler, true)).toBeNull();
  });
});
