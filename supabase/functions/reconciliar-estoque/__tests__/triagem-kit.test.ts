import { describe, it, expect, vi } from 'vitest';

// Fix round 3: a conferência de ativações usa a leitura ESTRITA (a frouxa confirmaria envelope 500 como null).
const ml = vi.hoisted(() => ({ estrita: [] as string[], frouxa: [] as string[] }));
vi.mock('../../_shared/operacoes/ml-status.ts', () => ({
  SemAcessoStatusML: class extends Error {},
  lerStatusML: async (_t: string, id: string) => { ml.frouxa.push(id); return 'ativo'; },
  lerStatusMLEstrito: async (t: string, id: string) => { ml.estrita.push(`${t}:${id}`); return 'ativo'; },
}));
import { triarParticipantes, alertarPublicacoesParadas, conferirAtivacoesPendentes, type DepsTriagem } from '../transferencias.ts';

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
  ativacoes?: Linha[];
  rpc?: (args: Record<string, unknown>, nome: string) => unknown;
}

function falso(b: Banco) {
  const rpcs: Array<Record<string, unknown>> = [];
  const tabelas: Record<string, Linha[]> = {
    organizations: b.orgs, kit_variacao_skus: b.kitSkus, kit_variacao_componentes: b.componentes,
    variacoes: b.variacoes, anuncios_externos_itens: b.itens, kit_exclusoes: b.exclusoes ?? [],
    kit_ativacoes: b.ativacoes ?? [],
  };
  const from = (t: string) => {
    const filtros: Array<(r: Linha) => boolean> = [];
    let faixa: [number, number] = [0, 999];
    let apagar = false;
    const api: Record<string, unknown> = {
      select: () => api, order: () => api,
      delete: () => { apagar = true; return api; },
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return api; },
      lt: (c: string, v: string) => { filtros.push((r) => String(r[c]) < v); return api; },
      contains: (c: string, vs: unknown[]) => { filtros.push((r) => vs.every((v) => (r[c] as unknown[]).includes(v))); return api; },
      range: (de: number, ate: number) => { faixa = [de, ate]; return api; },
      then: (res: (v: unknown) => unknown) => {
        if (apagar) tabelas[t] = tabelas[t].filter((r) => !filtros.every((f) => f(r)));
        return Promise.resolve({ data: tabelas[t].filter((r) => filtros.every((f) => f(r))).slice(faixa[0], faixa[1] + 1), error: null }).then(res);
      },
    };
    return api;
  };
  const nomes: string[] = [];
  const rpc = async (n: string, args: Record<string, unknown>) => {
    rpcs.push(args);
    nomes.push(n);
    return { data: b.rpc ? b.rpc(args, n) : { ok: true, id: `T-${rpcs.length}` }, error: null };
  };
  return { admin: { from, rpc } as never, rpcs, nomes, tabelas };
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

describe('conferirAtivacoesPendentes (Task 6, achado 1 e fix round 2)', () => {
  const AGORA = Date.parse('2026-11-07T12:00:00.000Z');
  const VENCIDO = '2026-11-01T00:00:00.000Z';
  const banco = () => {
    const ref: { t?: Record<string, Linha[]> } = {};
    const ativacao = (dono: string) => ref.t!.kit_ativacoes.find((r) => r.dono_id === dono);
    const f = falso({
      ...BANCO,
      exclusoes: [
        { org_id: 'O', codigo: 'P1', dono_tipo: 'ativacao', dono_id: 'D1' },
        { org_id: 'O', codigo: 'P2', dono_tipo: 'ativacao', dono_id: 'D2' },
        { org_id: 'O', codigo: 'P3', dono_tipo: 'ativacao', dono_id: 'D3' },
      ],
      ativacoes: [
        { org_id: 'O', dono_id: 'D1', ml_item_id: 'MLB1', alvos: ['MLB1', 'MLB1C'], codigos: ['P1'], geracao: 'G1', ate: VENCIDO },
        { org_id: 'O', dono_id: 'D2', ml_item_id: 'MLB2', alvos: ['MLB2'], codigos: ['P2'], geracao: 'G2', ate: VENCIDO },
        // Geração viva (PUT em voo ou outra conferência): não é lida.
        { org_id: 'O', dono_id: 'D3', ml_item_id: 'MLB3', alvos: ['MLB3'], codigos: ['P3'], geracao: 'G3', ate: '2026-11-07T12:05:00.000Z' },
      ],
      // Emula kit_ativacao_reivindicar / kit_ativacao_liberar sobre as tabelas do falso.
      rpc: (a, nome) => {
        const r = ativacao(a.p_dono as string);
        if (nome === 'kit_ativacao_reivindicar') {
          if (!r || (r.geracao !== a.p_geracao && String(r.ate) > new Date(AGORA).toISOString())) return { ok: false };
          r.geracao = a.p_geracao;
          return { ok: true, anterior: true };
        }
        if (nome === 'kit_ativacao_liberar') {
          if (!r || r.geracao !== a.p_geracao) return false;
          ref.t!.kit_ativacoes = ref.t!.kit_ativacoes.filter((x) => x !== r);
          ref.t!.kit_exclusoes = ref.t!.kit_exclusoes.filter((x) => x.dono_id !== a.p_dono);
          return true;
        }
        return null;
      },
    });
    ref.t = f.tabelas;
    return { f, ativacao };
  };

  it('reivindica, lê todos os alvos e libera só a confirmada; leitura que falha mantém e alerta; viva não é lida', async () => {
    const { f } = banco();
    const lidos: string[] = [];
    const alertar = vi.fn(async () => {});
    const n = await conferirAtivacoesPendentes(f.admin, {
      token: async () => 'tok',
      lerStatus: async (_o, id) => { lidos.push(id); if (id === 'MLB2') throw new Error('ML 500'); return 'ativo'; },
      alertar,
    }, AGORA);
    expect(n).toBe(1);
    expect(lidos).toEqual(['MLB1', 'MLB1C', 'MLB2']);
    expect(f.tabelas.kit_ativacoes.map((r) => r.dono_id)).toEqual(['D2', 'D3']);
    expect(f.tabelas.kit_exclusoes.map((r) => r.dono_id)).toEqual(['D2', 'D3']);
    expect(alertar).toHaveBeenCalledWith('O', expect.stringContaining('MLB2'));
    // Cada reivindicação traz geração nova e não reescreve alvos.
    const reiv = f.rpcs.filter((_r, i) => f.nomes[i] === 'kit_ativacao_reivindicar');
    expect(reiv.map((r) => [r.p_dono, r.p_alvos])).toEqual([['D1', null], ['D2', null]]);
    expect(reiv[0].p_geracao).not.toBe('G1');
  });

  it('P1-2: geração que mudou durante a conferência (retomada) não é liberada pelo snapshot', async () => {
    const { f, ativacao } = banco();
    const n = await conferirAtivacoesPendentes(f.admin, {
      token: async () => 'tok',
      lerStatus: async (_o, id) => { if (id === 'MLB1C') ativacao('D1')!.geracao = 'CLIQUE'; return 'ativo'; },
      alertar: async () => {},
    }, AGORA);
    expect(f.tabelas.kit_exclusoes.map((r) => r.dono_id)).toContain('D1');
    expect(f.tabelas.kit_ativacoes.map((r) => r.dono_id)).toContain('D1');
    expect(n).toBe(1);   // só D2
  });

  it('reivindicação recusada (outra execução assumiu): não lê nem libera', async () => {
    const { f, ativacao } = banco();
    ativacao('D1')!.ate = '2026-11-07T12:09:00.000Z';
    const lidos: string[] = [];
    await conferirAtivacoesPendentes(f.admin, { token: async () => 'tok', lerStatus: async (_o, id) => { lidos.push(id); return 'ativo'; }, alertar: async () => {} }, AGORA);
    expect(lidos).toEqual(['MLB2']);
    expect(f.tabelas.kit_exclusoes.map((r) => r.dono_id)).toContain('D1');
  });

  it('nunca libera por idade: exclusão velha sem confirmação fica', async () => {
    const { f } = banco();
    await conferirAtivacoesPendentes(f.admin, { token: async () => 'tok', lerStatus: async () => { throw new Error('fora'); }, alertar: async () => {} }, AGORA);
    expect(f.tabelas.kit_exclusoes).toHaveLength(3);
    expect(f.nomes).not.toContain('kit_ativacao_liberar');
  });

  it('fix round 3: sem `lerStatus` injetado, lê com lerStatusMLEstrito e o token da org', async () => {
    const { f } = banco();
    const n = await conferirAtivacoesPendentes(f.admin, { token: async (o) => `tok-${o}`, alertar: async () => {} }, AGORA);
    expect(n).toBe(2);
    expect(ml.estrita).toEqual(['tok-O:MLB1', 'tok-O:MLB1C', 'tok-O:MLB2']);
    expect(ml.frouxa).toEqual([]);
  });
});
