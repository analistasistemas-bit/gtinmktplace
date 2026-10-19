import { describe, expect, it } from 'vitest';
import {
  calcularSemaforoCanInvoice, listarItensFiscais, listarItensUP, listarSkusFamilia, skusOrfaosUP,
} from '../can-invoice.ts';

// Fake admin mínimo pra exercitar a query real de listarItensUP (Task 7 nunca testou
// diretamente essa implementação — só via vi.fn() injetado em DepsFiscal). Extraída pra shared
// na Task 8, ganha cobertura direta aqui.
function fakeAdmin(opts: {
  raizes?: Array<{ id: string }>;
  raizesErro?: string;
  itens?: Array<{ sku: string; item_externo_id: string | null }>;
  itensErro?: string;
  variacoes?: Array<{ codigo: string }>;
  variacoesErro?: string;
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
      if (t === 'variacoes') {
        return {
          select: () => ({ eq: () => ({ eq: async () =>
            opts.variacoesErro ? { data: null, error: { message: opts.variacoesErro } }
                                 : { data: opts.variacoes ?? [], error: null } }) }),
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

describe('listarSkusFamilia', () => {
  it('devolve os códigos das variações não excluídas da publicação', async () => {
    const admin = fakeAdmin({ variacoes: [{ codigo: 'S1' }, { codigo: 'S2' }] });
    expect(await listarSkusFamilia(admin, 'f1')).toEqual(['S1', 'S2']);
  });

  it('erro ao ler variações LANÇA — nunca degrada pra []', async () => {
    const admin = fakeAdmin({ variacoesErro: 'timeout' });
    await expect(listarSkusFamilia(admin, 'f1')).rejects.toThrow(/timeout/);
  });
});

describe('calcularSemaforoCanInvoice (AND por SKU, emenda D-10)', () => {
  it('[] de SKUs → null (nada a checar)', async () => {
    expect(await calcularSemaforoCanInvoice('tok', [], async () => ({ pronto: true, causa: null }))).toBeNull();
  });

  it('todos prontos → pronto=true, causa=null', async () => {
    const r = await calcularSemaforoCanInvoice('tok', ['S1', 'S2'], async () => ({ pronto: true, causa: null }));
    expect(r).toEqual({ pronto: true, causa: null });
  });

  it('AND: 1 SKU não-pronto derruba tudo, causa cita o SKU', async () => {
    const ler = async (_t: string, sku: string) => ({ pronto: sku === 'S1', causa: sku === 'S1' ? null : 'motivo-ml' });
    const r = await calcularSemaforoCanInvoice('tok', ['S1', 'S2'], ler);
    expect(r).toEqual({ pronto: false, causa: 'SKU S2: motivo-ml' });
  });

  it('qualquer leitura falhando (null) → null, nunca regride estado gravado (I7)', async () => {
    const ler = async (_t: string, sku: string) => (sku === 'S1' ? { pronto: true, causa: null } : null);
    expect(await calcularSemaforoCanInvoice('tok', ['S1', 'S2'], ler)).toBeNull();
  });
});

describe('skusOrfaosUP (fix round 1 — T8: gate compartilhado com o worker de push, Q3)', () => {
  it('Legacy (itensUP vazio): nunca há órfão — conceito não existe fora de UP', () => {
    expect(skusOrfaosUP(['S1', 'S2'], [])).toEqual([]);
  });

  it('UP: SKU sem entrada em itensUP é órfão', () => {
    const itensUP = [{ sku: 'S1', item_externo_id: 'I1' }];
    expect(skusOrfaosUP(['S1', 'S2'], itensUP)).toEqual(['S2']);
  });

  it('UP: SKU com item_externo_id null é órfão', () => {
    const itensUP = [{ sku: 'S1', item_externo_id: 'I1' }, { sku: 'S2', item_externo_id: null }];
    expect(skusOrfaosUP(['S1', 'S2'], itensUP)).toEqual(['S2']);
  });

  it('UP: todos resolvidos → []', () => {
    const itensUP = [{ sku: 'S1', item_externo_id: 'I1' }, { sku: 'S2', item_externo_id: 'I2' }];
    expect(skusOrfaosUP(['S1', 'S2'], itensUP)).toEqual([]);
  });
});

// C1 (auditoria fiscal 19/10): fake encadeável — `select('id')` = raízes UP; demais = linhas do split.
type Linha = { particao: number; item_externo_id: string | null; variacoes_externas: Record<string, unknown> };
function fakeAdminSplit(opts: { linhas?: Linha[]; itensUP?: Array<{ sku: string; item_externo_id: string | null }>; erro?: string }) {
  const lidas: string[] = [];
  return {
    lidas,
    admin: {
      from: (t: string) => {
        lidas.push(t);
        let cols = '';
        const q: Record<string, unknown> = {
          select: (c: string) => { cols = c; return q; }, eq: () => q, in: () => q,
          then: (ok: (v: unknown) => unknown) => {
            if (t === 'anuncios_externos_itens') return Promise.resolve({ data: opts.itensUP ?? [], error: null }).then(ok);
            if (cols === 'id') return Promise.resolve({ data: opts.itensUP?.length ? [{ id: 'raiz1' }] : [], error: null }).then(ok);
            if (opts.erro) return Promise.resolve({ data: null, error: { message: opts.erro } }).then(ok);
            return Promise.resolve({ data: opts.linhas ?? [], error: null }).then(ok);
          },
        };
        return q;
      },
    } as never,
  };
}

describe('listarItensFiscais (C1)', () => {
  const L = (particao: number, item: string, skus: string[]): Linha => ({
    particao, item_externo_id: item, variacoes_externas: Object.fromEntries(skus.map((k) => [k, {}])),
  });

  it('split: cada SKU no item da sua partição; SKU sem partição → null (órfão)', async () => {
    const { admin } = fakeAdminSplit({ linhas: [L(0, 'MLB0', ['A', 'B']), L(1, 'MLB1', ['C'])] });
    expect(await listarItensFiscais(admin, 'o1', 'CP1', ['A', 'B', 'C', 'D'], 'MLB0')).toEqual([
      { sku: 'A', item_externo_id: 'MLB0' }, { sku: 'B', item_externo_id: 'MLB0' },
      { sku: 'C', item_externo_id: 'MLB1' }, { sku: 'D', item_externo_id: null },
    ]);
  });

  it('split sem linha da partição 0: SKU sem partição herda a raiz de familias.ml_item_id', async () => {
    const { admin } = fakeAdminSplit({ linhas: [L(1, 'MLB1', ['C'])] });
    expect(await listarItensFiscais(admin, 'o1', 'CP1', ['A', 'C'], 'MLB0')).toEqual([
      { sku: 'A', item_externo_id: 'MLB0' }, { sku: 'C', item_externo_id: 'MLB1' },
    ]);
  });

  it('só partição 0 (Legacy de 1 anúncio) → [] (fallback familias.ml_item_id)', async () => {
    const { admin } = fakeAdminSplit({ linhas: [L(0, 'MLB0', ['A'])] });
    expect(await listarItensFiscais(admin, 'o1', 'CP1', ['A'], 'MLB0')).toEqual([]);
  });

  it('com itens UP → devolve os UP sem consultar o split', async () => {
    const { admin, lidas } = fakeAdminSplit({ itensUP: [{ sku: 'S1', item_externo_id: 'MLB9' }], linhas: [L(1, 'MLBX', ['S1'])] });
    expect(await listarItensFiscais(admin, 'o1', 'CP1', ['S1'], 'MLB0')).toEqual([{ sku: 'S1', item_externo_id: 'MLB9' }]);
    expect(lidas.filter((t) => t === 'anuncios_externos')).toHaveLength(1); // só a leitura das raízes UP
  });

  it('erro de leitura LANÇA listarItensFiscais', async () => {
    const { admin } = fakeAdminSplit({ erro: 'timeout' });
    await expect(listarItensFiscais(admin, 'o1', 'CP1', ['A'], null)).rejects.toThrow(/listarItensFiscais/);
  });
});
