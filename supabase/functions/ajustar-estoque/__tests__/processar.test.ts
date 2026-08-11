import { describe, it, expect } from 'vitest';
import { processarAjuste, type DepsAjuste } from '../processar.ts';

type DepsTeste = DepsAjuste & { filas: unknown[] };

function deps(over: Partial<DepsAjuste> = {}): DepsTeste {
  const filas: unknown[] = [];
  return {
    filas,
    rpc: async () => ({ data: 0, error: null }),
    lerMovimento: async () => ({ codigo_pai: '26705343', estoque_resultante: 0 }),
    enfileirar: async (job) => { filas.push(job); return 'msg_1'; },
    ...over,
  } as DepsTeste;
}

const base = { orgId: 'org1', userId: 'u1', ref: 'abc', observacao: null };

describe('processarAjuste', () => {
  it('aplica cada item e enfileira um push por codigo_pai', async () => {
    const d = deps();
    const r = await processarAjuste(d, {
      ...base,
      itens: [{ codigo: '18760903', novoSaldo: 0 }, { codigo: '26706073', novoSaldo: 0 }],
    });
    expect(r.resultados).toEqual([
      { codigo: '18760903', estoque: 0, duplicada: false },
      { codigo: '26706073', estoque: 0, duplicada: false },
    ]);
    expect(d.filas).toEqual([{ org_id: 'org1', codigo_pai: '26705343', canal_origem: null }]);
    expect(r.pushOk).toBe(true);
  });

  it('usa uma referência distinta por item', async () => {
    const refs: string[] = [];
    const d = deps({
      rpc: async (_n, args) => { refs.push(args.p_ref as string); return { data: 0, error: null }; },
    });
    await processarAjuste(d, { ...base, itens: [{ codigo: 'A', novoSaldo: 0 }, { codigo: 'B', novoSaldo: 0 }] });
    expect(refs).toEqual(['ajuste:abc:A', 'ajuste:abc:B']);
  });

  it('repassa observação e usuário para a RPC', async () => {
    let args: Record<string, unknown> = {};
    const d = deps({ rpc: async (_n, a) => { args = a; return { data: 0, error: null }; } });
    await processarAjuste(d, { ...base, observacao: 'sobrou nada', itens: [{ codigo: 'A', novoSaldo: 0 }] });
    expect(args).toMatchObject({
      p_org: 'org1', p_codigo: 'A', p_novo_saldo: 0, p_obs: 'sobrou nada', p_criado_por: 'u1',
    });
  });

  it('item que falha não impede os seguintes', async () => {
    let n = 0;
    const d = deps({
      rpc: async () => {
        n += 1;
        return n === 1
          ? { data: null, error: { message: 'ajuste só reduz saldo' } }
          : { data: 5, error: null };
      },
    });
    const r = await processarAjuste(d, {
      ...base, itens: [{ codigo: 'A', novoSaldo: 9 }, { codigo: 'B', novoSaldo: 5 }],
    });
    expect(r.resultados[0]).toEqual({ codigo: 'A', estoque: null, duplicada: false, erro: 'ajuste só reduz saldo' });
    expect(r.resultados[1]).toEqual({ codigo: 'B', estoque: 5, duplicada: false });
  });

  // data null da RPC = referência já aplicada. O push TEM de sair mesmo assim: se a primeira
  // tentativa gravou e morreu antes de enfileirar, o retry cairia aqui e o push se perderia.
  it('duplicada ainda enfileira o push e devolve o saldo do movimento', async () => {
    const d = deps({
      rpc: async () => ({ data: null, error: null }),
      lerMovimento: async () => ({ codigo_pai: '26705343', estoque_resultante: 7 }),
    });
    const r = await processarAjuste(d, { ...base, itens: [{ codigo: 'A', novoSaldo: 7 }] });
    expect(r.resultados[0]).toEqual({ codigo: 'A', estoque: 7, duplicada: true });
    expect(d.filas).toHaveLength(1);
  });

  it('não repete o push quando dois SKUs são do mesmo produto', async () => {
    const d = deps();
    await processarAjuste(d, { ...base, itens: [{ codigo: 'A', novoSaldo: 0 }, { codigo: 'B', novoSaldo: 0 }] });
    expect(d.filas).toHaveLength(1);
  });

  it('enfileira um push por produto quando os SKUs são de produtos diferentes', async () => {
    let n = 0;
    const d = deps({
      lerMovimento: async () => { n += 1; return { codigo_pai: n === 1 ? 'P1' : 'P2', estoque_resultante: 0 }; },
    });
    await processarAjuste(d, { ...base, itens: [{ codigo: 'A', novoSaldo: 0 }, { codigo: 'B', novoSaldo: 0 }] });
    expect(d.filas).toEqual([
      { org_id: 'org1', codigo_pai: 'P1', canal_origem: null },
      { org_id: 'org1', codigo_pai: 'P2', canal_origem: null },
    ]);
  });

  it('falha de enfileiramento não derruba o ajuste, só marca pushOk=false', async () => {
    const d = deps({ enfileirar: async () => { throw new Error('QStash fora'); } });
    const r = await processarAjuste(d, { ...base, itens: [{ codigo: 'A', novoSaldo: 0 }] });
    expect(r.resultados[0].estoque).toBe(0);
    expect(r.pushOk).toBe(false);
  });

  it('não enfileira push para item que falhou', async () => {
    const d = deps({ rpc: async () => ({ data: null, error: { message: 'SKU não encontrado' } }) });
    const r = await processarAjuste(d, { ...base, itens: [{ codigo: 'A', novoSaldo: 0 }] });
    expect(r.resultados[0].erro).toBe('SKU não encontrado');
    expect(d.filas).toHaveLength(0);
  });
});
