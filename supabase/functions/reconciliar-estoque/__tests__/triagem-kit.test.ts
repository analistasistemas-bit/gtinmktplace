import { describe, it, expect, vi } from 'vitest';
import { triarParticipantes, alertarPublicacoesParadas, type DepsTriagem } from '../transferencias.ts';

// ADR-0197 (Task 5, ruling da dúvida 2): todo SKU participante, sem filtro de status local nem janela de
// 24 h, é comparado com o ML; só a diferença vira transferência `entrada`.

type Linha = Record<string, unknown>;
interface Banco {
  orgs: Linha[];
  kitSkus: Linha[];
  componentes: Linha[];
  variacoes: Linha[];
  itens: Linha[];
  exclusoes?: Linha[];
  rpc?: (args: Record<string, unknown>) => unknown;
}

function falso(b: Banco) {
  const rpcs: Array<Record<string, unknown>> = [];
  const tabelas: Record<string, Linha[]> = {
    organizations: b.orgs, kit_variacao_skus: b.kitSkus, kit_variacao_componentes: b.componentes,
    variacoes: b.variacoes, anuncios_externos_itens: b.itens, kit_exclusoes: b.exclusoes ?? [],
  };
  const from = (t: string) => {
    const filtros: Array<(r: Linha) => boolean> = [];
    let faixa: [number, number] = [0, 999];
    const api: Record<string, unknown> = {
      select: () => api, order: () => api,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return api; },
      lt: (c: string, v: string) => { filtros.push((r) => String(r[c]) < v); return api; },
      contains: (c: string, vs: unknown[]) => { filtros.push((r) => vs.every((v) => (r[c] as unknown[]).includes(v))); return api; },
      range: (de: number, ate: number) => { faixa = [de, ate]; return api; },
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: tabelas[t].filter((r) => filtros.every((f) => f(r))).slice(faixa[0], faixa[1] + 1), error: null }).then(res),
    };
    return api;
  };
  const rpc = async (_n: string, args: Record<string, unknown>) => {
    rpcs.push(args);
    return { data: b.rpc ? b.rpc(args) : { ok: true, id: `T-${rpcs.length}` }, error: null };
  };
  return { admin: { from, rpc } as never, rpcs };
}

const fam = (criado_em: string) => ({ criado_em });
const BANCO: Banco = {
  orgs: [{ id: 'O', modulos_habilitados: ['kit_variacao'] }, { id: 'X', modulos_habilitados: [] }],
  kitSkus: [{ org_id: 'O', codigo: 'K1' }],
  componentes: [{ org_id: 'O', codigo: 'P1' }, { org_id: 'O', codigo: 'P2' }, { org_id: 'O', codigo: 'P3' }, { org_id: 'X', codigo: 'Z' }],
  variacoes: [
    { org_id: 'O', codigo: 'P1', estoque: 9, familias: fam('2026-01-01') },
    { org_id: 'O', codigo: 'P1', estoque: 5, familias: fam('2026-06-01') },   // canônica
    { org_id: 'O', codigo: 'P2', estoque: 4, familias: fam('2026-06-01') },
    { org_id: 'O', codigo: 'P3', estoque: 2, familias: fam('2026-06-01') },
    { org_id: 'O', codigo: 'K1', estoque: 1, familias: fam('2026-06-01') },
    { org_id: 'X', codigo: 'Z', estoque: 7, familias: fam('2026-06-01') },
  ],
  itens: [
    // Item local pausado também entra: sem filtro de status.
    { org_id: 'O', sku: 'P1', item_externo_id: 'MLB-P1', user_product_id: 'UP-P1', catalog_listing_id: 'MLB-P1C', retirado: false, status: 'pausado' },
    { org_id: 'O', sku: 'P2', item_externo_id: 'MLB-P2', user_product_id: 'UP-P2', catalog_listing_id: null, retirado: false, status: 'ativo' },
    { org_id: 'O', sku: 'K1', item_externo_id: 'MLB-K1', user_product_id: 'UP-K1', catalog_listing_id: null, retirado: false, status: 'ativo' },
  ],
};
const ML: Record<string, number> = { 'UP-P1': 3, 'UP-P2': 4, 'UP-K1': 1 };

function deps(b: Banco, over: Partial<DepsTriagem> = {}) {
  const f = falso(b);
  const d: DepsTriagem = {
    admin: f.admin,
    lerQuantidade: vi.fn(async (_o: string, up: string) => ML[up]),
    enfileirarSaga: vi.fn(async () => {}),
    alertar: vi.fn(async () => {}),
    ...over,
  };
  return { d, rpcs: f.rpcs };
}

describe('triarParticipantes', () => {
  it('só o SKU com local ≠ ML vira transferência; sem UP alerta; org sem módulo fica de fora', async () => {
    const { d, rpcs } = deps(BANCO);
    expect(await triarParticipantes(d)).toBe(1);
    expect(rpcs).toEqual([{
      p_org: 'O', p_kit: null, p_tipo: 'entrada', p_itens: [{ codigo: 'P1', quantidade: 0 }],
      p_alvos: [{ codigo: 'P1', up_id: 'UP-P1', item_ids: ['MLB-P1', 'MLB-P1C'] }],
    }]);
    expect(d.enfileirarSaga).toHaveBeenCalledWith('T-1', 'O');
    expect(d.lerQuantidade).not.toHaveBeenCalledWith('X', expect.anything(), expect.anything());
    expect(d.alertar).toHaveBeenCalledWith('O', expect.stringContaining('P3'));
  });

  it('alvos_invalidos alerta; up_ocupado espera a próxima triagem sem enfileirar', async () => {
    const r1 = deps({ ...BANCO, rpc: () => ({ ok: false, motivo: 'alvos_invalidos' }) });
    await triarParticipantes(r1.d);
    expect(r1.d.alertar).toHaveBeenCalledWith('O', expect.stringContaining('P1'));
    const r2 = deps({ ...BANCO, rpc: () => ({ ok: false, motivo: 'up_ocupado' }) });
    expect(await triarParticipantes(r2.d)).toBe(0);
    expect(r2.d.enfileirarSaga).not.toHaveBeenCalled();
  });

  it('leitura do ML que falha num SKU não derruba os outros', async () => {
    const ler = vi.fn(async (_o: string, up: string) => { if (up === 'UP-P1') throw new Error('ML 500'); return 0; });
    const { d, rpcs } = deps(BANCO, { lerQuantidade: ler });
    await triarParticipantes(d);
    expect(rpcs.map((r) => (r.p_itens as Array<{ codigo: string }>)[0].codigo)).toEqual(['K1', 'P2']);
  });
});

describe('triarParticipantes — volume e retirados', () => {
  it('mais de 1.000 variações históricas do SKU: pagina e acha a canônica', async () => {
    const historico = Array.from({ length: 1500 }, (_, i) => ({
      org_id: 'O', codigo: 'P2', estoque: 100 + i, familias: fam(`2025-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`),
    }));
    // A canônica (mais recente) fica depois da linha 1.000: ML 4 × local 4, sem transferência.
    const b: Banco = { ...BANCO, componentes: [{ org_id: 'O', codigo: 'P2' }], kitSkus: [],
      variacoes: [...historico, { org_id: 'O', codigo: 'P2', estoque: 4, familias: fam('2026-06-01') }] };
    const { d, rpcs } = deps(b);
    await triarParticipantes(d);
    expect(rpcs).toEqual([]);
  });

  it('item retirado não serve de alvo: SKU só com item retirado alerta como sem UP', async () => {
    const b: Banco = { ...BANCO, itens: BANCO.itens.map((i) => (i.sku === 'P2' ? { ...i, retirado: true } : i)) };
    const ler = vi.fn(async (_o: string, up: string) => (up === 'UP-P2' ? 0 : ML[up]));
    const { d, rpcs } = deps(b, { lerQuantidade: ler });
    await triarParticipantes(d);
    expect(rpcs.map((r) => (r.p_itens as Array<{ codigo: string }>)[0].codigo)).toEqual(['P1']);
    expect(d.alertar).toHaveBeenCalledWith('O', expect.stringMatching(/P2/));
  });
});

describe('alertarPublicacoesParadas', () => {
  it('alerta exclusão de publicação com mais de 1 h, agrupada por org; recente e de transferência ficam de fora', async () => {
    const { d } = deps({
      ...BANCO,
      exclusoes: [
        { org_id: 'O', codigo: 'P1', dono_tipo: 'publicacao', criado_em: '2026-11-07T08:00:00.000Z' },
        { org_id: 'O', codigo: 'P2', dono_tipo: 'publicacao', criado_em: '2026-11-07T11:50:00.000Z' },
        { org_id: 'O', codigo: 'K1', dono_tipo: 'transferencia', criado_em: '2026-11-01T00:00:00.000Z' },
      ],
    });
    const alertar = vi.fn(async () => {});
    expect(await alertarPublicacoesParadas(d.admin, alertar, Date.parse('2026-11-07T12:00:00.000Z'))).toBe(1);
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(alertar).toHaveBeenCalledWith('O', expect.stringMatching(/P1(?!.*P2)/));
  });
});
