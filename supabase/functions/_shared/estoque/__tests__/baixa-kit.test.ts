import { describe, it, expect } from 'vitest';
import { registrarBaixaVenda, refBaixa } from '../baixa.ts';

interface ChamadaRpc { fn: string; args: Record<string, unknown> }

function fakeAdmin(opts: {
  kits: Record<string, { base: string; n: number }>;
  /** `codigo_pai` da família base -> id da família e o(s) código(s) de variação dela.
   *  Ausente = família base "não encontrada" (dispara `erro`). */
  bases?: Record<string, { id: string; variacoes: string[] }>;
  chamadas: ChamadaRpc[];
  updates: Array<Record<string, unknown>>;
  /** Default 100 (saldo farto — nunca gera vendaAcimaSaldo/desyncMl nos testes que não pedem). */
  estoqueAnterior?: number;
}) {
  const bases = opts.bases ?? {};
  // `variacoes` é consultada duas vezes num kit: 1ª por `codigo` (resolve a família do SKU
  // vendido), 3ª por `familia_id` (lista a(s) variação(ões) da base). Contador alterna entre
  // as duas formas — nenhum teste aqui resolve mais de um SKU por vez.
  let chamadasVariacoes = 0;

  // 1ª consulta: `variacoes` -> `familias!inner(...)` por `(org_id, codigo)`.
  const queryPorCodigo = (): any => {
    let codigo = '';
    const self: any = {
      select: () => self,
      eq: (coluna: string, valor: string) => { if (coluna === 'codigo') codigo = valor; return self; },
      order: () => self,
      limit: () => self,
      maybeSingle: () => {
        const k = opts.kits[codigo];
        return Promise.resolve({
          data: k
            ? { familias: { codigo_pai: `KIT-${codigo}`, kit_base_codigo_pai: k.base, kit_multiplicador: k.n } }
            : { familias: { codigo_pai: 'PAI-1', kit_base_codigo_pai: null, kit_multiplicador: null } },
          error: null,
        });
      },
    };
    return self;
  };

  // 2ª consulta (só em kit): `familias` -> `id` por `codigo_pai = base`.
  const queryFamiliaBase = (): any => {
    let basePai = '';
    const self: any = {
      select: () => self,
      eq: (coluna: string, valor: string) => { if (coluna === 'codigo_pai') basePai = valor; return self; },
      order: () => self,
      limit: () => self,
      maybeSingle: () => {
        const b = bases[basePai];
        return Promise.resolve({ data: b ? { id: b.id } : null, error: null });
      },
    };
    return self;
  };

  // 3ª consulta (só em kit): `variacoes` -> `codigo` por `familia_id`.
  const queryVariacoesDaBase = (): any => {
    let familiaId = '';
    const self: any = {
      select: () => self,
      eq: (coluna: string, valor: string) => { if (coluna === 'familia_id') familiaId = valor; return self; },
      then: (res: (v: unknown) => unknown) => {
        const entry = Object.values(bases).find((b) => b.id === familiaId);
        const lista = (entry?.variacoes ?? []).map((codigo) => ({ codigo }));
        return Promise.resolve({ data: lista, error: null }).then(res);
      },
    };
    return self;
  };

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
    from: (tabela: string) => {
      if (tabela === 'variacoes') {
        chamadasVariacoes++;
        return chamadasVariacoes % 2 === 1 ? queryPorCodigo() : queryVariacoesDaBase();
      }
      if (tabela === 'familias') return queryFamiliaBase();
      return movimentosQuery;
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      opts.chamadas.push({ fn, args });
      const anterior = opts.estoqueAnterior ?? 100;
      const pedida = args.p_qtd as number;
      return Promise.resolve({
        data: {
          aplicado: true, motivo: 'venda', movimento_id: 'mov-1', codigo_pai: 'PAI-BASE',
          estoque_anterior: anterior, quantidade_pedida: pedida, quantidade_aplicada: Math.min(anterior, pedida),
        },
        error: null,
      });
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

it('venda de kit baixa N× no codigo da VARIAÇÃO da base, não no codigo_pai nem no SKU do kit', async () => {
  const chamadas: ChamadaRpc[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = fakeAdmin({
    kits: { '00000021': { base: '00000010', n: 3 } },
    bases: { '00000010': { id: 'f-base-10', variacoes: ['00000012'] } },
    chamadas, updates,
  });

  await registrarBaixaVenda(admin, {
    orgId: 'org-1', canal: 'mercado_livre', orderId: 777,
    itens: [{ codigo: '00000021', quantity: 2, ml_item_id: 'MLB-KIT' }],
  });

  expect(chamadas.length).toEqual(1);
  expect(chamadas[0].fn).toEqual('baixar_estoque');
  // Código da variação da base (nunca `00000010`, que é o `codigo_pai` — bug do ADR-0151).
  expect(chamadas[0].args.p_codigo).toEqual('00000012');
  expect(chamadas[0].args.p_qtd).toEqual(6);
  // A referência continua no SKU VENDIDO — é o que o estorno procura.
  expect(chamadas[0].args.p_ref).toEqual(refBaixa('mercado_livre', 777, '00000021'));
});

it('venda de kit anota a origem no movimento (auditoria, D-6)', async () => {
  const chamadas: ChamadaRpc[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = fakeAdmin({
    kits: { '00000021': { base: '00000010', n: 3 } },
    bases: { '00000010': { id: 'f-base-10', variacoes: ['00000012'] } },
    chamadas, updates,
  });

  await registrarBaixaVenda(admin, {
    orgId: 'org-1', canal: 'mercado_livre', orderId: 777,
    itens: [{ codigo: '00000021', quantity: 1, ml_item_id: 'MLB-KIT' }],
  });

  const anotacao = updates.find((u) => 'origem_kit_multiplicador' in u);
  expect(anotacao?.origem_kit_multiplicador).toEqual(3);
  expect(anotacao?.origem_kit_codigo_pai).toEqual('KIT-00000021');
});

it('venda de kit com saldo zerado na base gera desyncMl em unidades da base, com atribuição', async () => {
  const chamadas: ChamadaRpc[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = fakeAdmin({
    kits: { '00000021': { base: '00000010', n: 3 } },
    bases: { '00000010': { id: 'f-base-10', variacoes: ['00000012'] } },
    chamadas, updates, estoqueAnterior: 0,
  });

  const r = await registrarBaixaVenda(admin, {
    orgId: 'org-1', canal: 'mercado_livre', orderId: 777,
    itens: [{ codigo: '00000021', quantity: 2, ml_item_id: 'MLB-KIT' }],
  });

  // 2 kits de 3 = 6 un. da base (não 2, que é o que o ML mostrou no pedido).
  expect(r.desyncMl).toEqual([
    { codigo: '00000021', pedido: 6, kitCodigoPai: 'KIT-00000021', multiplicador: 3 },
  ]);
  expect(r.vendaAcimaSaldo).toEqual([]);
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

it('origem não resolvida (kit sem família base) entra em falhas e NÃO chama a RPC', async () => {
  const chamadas: ChamadaRpc[] = [];
  const updates: Array<Record<string, unknown>> = [];
  // Base '00000050' não existe em `bases` -> `resolverOrigemEstoque` devolve `erro`.
  const admin = fakeAdmin({
    kits: { '00000099': { base: '00000050', n: 2 } },
    chamadas, updates,
  });

  const r = await registrarBaixaVenda(admin, {
    orgId: 'org-1', canal: 'mercado_livre', orderId: 999,
    itens: [{ codigo: '00000099', quantity: 1, ml_item_id: 'MLB-KIT-ERRO' }],
  });

  expect(chamadas.length).toEqual(0);
  expect(r.falhas).toEqual([
    { codigo: '00000099', mensagem: expect.stringContaining('00000050') },
  ]);
});
