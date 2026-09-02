import { describe, it, expect } from 'vitest';
import { registrarBaixaVenda, refBaixa } from '../baixa.ts';

interface ChamadaRpc { fn: string; args: Record<string, unknown> }

function fakeAdmin(opts: {
  kits: Record<string, { base: string; n: number }>;
  chamadas: ChamadaRpc[];
  updates: Array<Record<string, unknown>>;
}) {
  // eq('org_id', ...) não importa aqui; eq('codigo', ...) é o que decide qual variação está
  // sendo resolvida — é o argumento real, não um `_setCodigo` externo nunca chamado por
  // produção (o helper original do brief ficava sempre em codigo='', neutro por acidente).
  const variacaoQuery = (codigo: string): any => ({
    select: () => variacaoQuery(codigo),
    eq: (coluna: string, valor: string) => variacaoQuery(coluna === 'codigo' ? valor : codigo),
    order: () => variacaoQuery(codigo),
    limit: () => variacaoQuery(codigo),
    maybeSingle: () => {
      const k = opts.kits[codigo];
      return Promise.resolve({
        data: k
          ? { familias: { codigo_pai: `KIT-${codigo}`, kit_base_codigo_pai: k.base, kit_multiplicador: k.n } }
          : { familias: { codigo_pai: 'PAI-1', kit_base_codigo_pai: null, kit_multiplicador: null } },
        error: null,
      });
    },
  });
  const movimentosQuery = {
    select: () => movimentosQuery,
    eq: () => movimentosQuery,
    is: () => movimentosQuery,
    neq: () => movimentosQuery,
    in: () => Promise.resolve({ data: [], error: null }),
    lt: () => movimentosQuery,
    order: () => movimentosQuery,
    limit: () => Promise.resolve({ data: [], error: null }),
    insert: () => Promise.resolve({ error: null }),
    update: (patch: Record<string, unknown>) => {
      opts.updates.push(patch);
      return { eq: () => Promise.resolve({ error: null }) };
    },
  };
  return {
    from: (tabela: string) => (tabela === 'variacoes' ? variacaoQuery('') : movimentosQuery),
    rpc: (fn: string, args: Record<string, unknown>) => {
      opts.chamadas.push({ fn, args });
      return Promise.resolve({
        data: {
          aplicado: true, motivo: 'venda', movimento_id: 'mov-1', codigo_pai: 'PAI-BASE',
          estoque_anterior: 100, quantidade_pedida: args.p_qtd, quantidade_aplicada: args.p_qtd,
        },
        error: null,
      });
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

it('venda de kit baixa N× no codigo_pai da BASE, não no SKU do kit', async () => {
  const chamadas: ChamadaRpc[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = fakeAdmin({ kits: { '00000021': { base: '00000010', n: 3 } }, chamadas, updates });

  await registrarBaixaVenda(admin, {
    orgId: 'org-1', canal: 'mercado_livre', orderId: 777,
    itens: [{ codigo: '00000021', quantity: 2, ml_item_id: 'MLB-KIT' }],
  });

  expect(chamadas.length).toEqual(1);
  expect(chamadas[0].fn).toEqual('baixar_estoque');
  // Código canônico da base, quantidade multiplicada.
  expect(chamadas[0].args.p_codigo).toEqual('00000010');
  expect(chamadas[0].args.p_qtd).toEqual(6);
  // A referência continua no SKU VENDIDO — é o que o estorno procura.
  expect(chamadas[0].args.p_ref).toEqual(refBaixa('mercado_livre', 777, '00000021'));
});

it('venda de kit anota a origem no movimento (auditoria, D-6)', async () => {
  const chamadas: ChamadaRpc[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = fakeAdmin({ kits: { '00000021': { base: '00000010', n: 3 } }, chamadas, updates });

  await registrarBaixaVenda(admin, {
    orgId: 'org-1', canal: 'mercado_livre', orderId: 777,
    itens: [{ codigo: '00000021', quantity: 1, ml_item_id: 'MLB-KIT' }],
  });

  const anotacao = updates.find((u) => 'origem_kit_multiplicador' in u);
  expect(anotacao?.origem_kit_multiplicador).toEqual(3);
  expect(anotacao?.origem_kit_codigo_pai).toEqual('KIT-00000021');
});

it('venda de SKU comum não resolve nada e não anota origem de kit', async () => {
  const chamadas: ChamadaRpc[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = fakeAdmin({ kits: {}, chamadas, updates });

  await registrarBaixaVenda(admin, {
    orgId: 'org-1', canal: 'mercado_livre', orderId: 888,
    itens: [{ codigo: '00000011', quantity: 4, ml_item_id: 'MLB-BASE' }],
  });

  expect(chamadas[0].args.p_codigo).toEqual('00000011');
  expect(chamadas[0].args.p_qtd).toEqual(4);
  const anotacao = updates.find((u) => 'origem_kit_multiplicador' in u);
  expect(anotacao?.origem_kit_multiplicador).toEqual(null);
  expect(anotacao?.origem_kit_codigo_pai).toEqual(null);
});
