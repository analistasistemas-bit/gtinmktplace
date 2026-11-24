// ADR-0121, emenda 8: prova de que o envio cancelado nunca saiu, e as leituras do banco que decidem a reposição.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  baixasAbertas, filaAssume, lerNuncaSaiu, notificacaoJaEnviada, provaNuncaSaiu, saldoMexidoDepois,
} from '../nunca-saiu.ts';

/** Formato medido de GET /shipments/{id}/history em 24/11. */
const historico = (over: Record<string, unknown> = {}, datas: Record<string, unknown> = {}) => ({
  id: 45, status: 'cancelled', substatus: null, mode: 'me2', order_id: 1,
  date_history: {
    date_shipped: null, date_returned: null, date_delivered: null, date_not_delivered: null,
    date_created: '2026-11-20T10:00:00.000-04:00', date_cancelled: '2026-11-21T10:00:00.000-04:00',
    date_handling: '2026-11-20T10:01:00.000-04:00', date_first_printed: null,
    date_ready_to_ship: '2026-11-20T10:02:00.000-04:00', date_delivered_estimated: null, ...datas,
  },
  ...over,
});
const DATAS = ['date_first_printed', 'date_shipped', 'date_delivered', 'date_not_delivered', 'date_returned'];

describe('provaNuncaSaiu', () => {
  it('cancelado, me2, nunca impresso nem despachado: prova (id em número ou texto)', () => {
    expect(provaNuncaSaiu(historico(), 45)).toBe(true);
    expect(provaNuncaSaiu(historico(), '45')).toBe(true);
  });
  it.each(DATAS)('%s preenchida, ausente ou vazia: não prova', (campo) => {
    expect(provaNuncaSaiu(historico({}, { [campo]: '2026-11-20T11:00:00.000-04:00' }), 45)).toBe(false);
    expect(provaNuncaSaiu(historico({}, { [campo]: undefined }), 45)).toBe(false);
    expect(provaNuncaSaiu(historico({}, { [campo]: '' }), 45)).toBe(false);
  });
  it.each([
    ['outro id', { id: 46 }], ['sem id', { id: undefined }], ['outro status', { status: 'shipped' }], ['sem status', { status: undefined }],
    ['pack_splitted', { substatus: 'pack_splitted' }], ['sem substatus no corpo', { substatus: undefined }], ['mode me1', { mode: 'me1' }], ['sem mode', { mode: undefined }], ['sem date_history', { date_history: undefined }],
    ['date_history nulo', { date_history: null }], ['date_history lista', { date_history: [] }],
  ])('%s: não prova', (_n, over) => expect(provaNuncaSaiu(historico(over), 45)).toBe(false));
  it.each([[null], [undefined], ['x'], [7], [[]], [{}]])('corpo %j: não prova', (h) => expect(provaNuncaSaiu(h, 45)).toBe(false));
});

describe('lerNuncaSaiu', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const responde = (status: number, corpo: unknown = historico()) => {
    const f = vi.fn((_u: string, _i?: RequestInit) => Promise.resolve(new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status })));
    vi.stubGlobal('fetch', f);
    return f;
  };
  it('200 com a prova: sim, lendo só o histórico do envio, com token e prazo', async () => {
    const f = responde(200);
    expect(await lerNuncaSaiu('tk', 45)).toBe('sim');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.mercadolibre.com/shipments/45/history');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tk' });
    expect(init?.signal).toBeTruthy();
  });
  it('200 sem a prova (impressa, corpo nulo): nao', async () => {
    responde(200, historico({}, { date_first_printed: '2026-11-20T11:00:00.000-04:00' }));
    expect(await lerNuncaSaiu('tk', 45)).toBe('nao');
    responde(200, null);
    expect(await lerNuncaSaiu('tk', 45)).toBe('nao');
  });
  it.each([400, 404, 410])('HTTP %i definitivo: nao', async (s) => { responde(s); expect(await lerNuncaSaiu('tk', 45)).toBe('nao'); });
  it.each([401, 403, 408, 429, 500, 503])('HTTP %i: indisponivel', async (s) => {
    responde(s);
    expect(await lerNuncaSaiu('tk', 45)).toBe('indisponivel');
  });
  it('corpo ilegível ou rede: indisponivel, sem lançar', async () => {
    responde(200, '<html>');
    expect(await lerNuncaSaiu('tk', 45)).toBe('indisponivel');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('rede'))));
    expect(await lerNuncaSaiu('tk', 45)).toBe('indisponivel');
  });
  it('sem resposta: indisponivel pelo prazo de 8 s', async () => {
    const prazo = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('t', 'TimeoutError')));
    vi.stubGlobal('fetch', vi.fn((_u: string, i?: RequestInit) => (i?.signal?.aborted ? Promise.reject(i.signal.reason) : new Promise(() => {}))));
    expect(await lerNuncaSaiu('tk', 45)).toBe('indisponivel');
    expect(prazo).toHaveBeenCalledWith(8_000);
    prazo.mockRestore();
  });
});

type Linha = Record<string, unknown>;
/** Banco em memória: aplica os filtros de verdade. `erro` = tabela ou RPC que falha. */
function banco(tabelas: Record<string, Linha[]>, erro?: string) {
  const lidas: string[] = [];
  const like = (v: string) => new RegExp(`^${v.replace(/%/g, '.*').replace(/_/g, '.')}$`);
  const from = (t: string) => {
    lidas.push(t);
    let ls = tabelas[t] ?? [];
    const f = (p: (l: Linha) => boolean) => { ls = ls.filter(p); return q; };
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => q, limit: (n: number) => { ls = ls.slice(0, n); return q; },
      eq: (k: string, v: unknown) => f((l) => String(l[k]) === String(v)),
      in: (k: string, v: unknown[]) => f((l) => v.includes(l[k])),
      is: (k: string, v: unknown) => f((l) => (l[k] ?? null) === v),
      not: (k: string, _o: string, v: unknown) => f((l) => (l[k] ?? null) !== v),
      neq: (k: string, v: unknown) => f((l) => l[k] !== v),
      gt: (k: string, v: string) => f((l) => String(l[k]) > v),
      lt: (k: string, v: number) => f((l) => Number(l[k]) < v),
      like: (k: string, v: string) => f((l) => like(v).test(String(l[k]))),
      then: (ok: (r: unknown) => unknown) => Promise.resolve(erro === t ? { data: null, error: { message: 'fora' } } : { data: ls, error: null }).then(ok),
    };
    return q;
  };
  const rpc = (fn: string, a: { p_org: string; p_orders: string[] }) => {
    lidas.push(fn);
    if (erro === fn || fn !== 'cancelamento_baixas') return Promise.resolve({ data: null, error: { message: 'fora' } });
    const pref = `mercado_livre:${a.p_orders[0]}:`;
    const ms = (tabelas.estoque_movimentos ?? []).filter((m) => m.org_id === a.p_org);
    const ds = ms.filter((m) => m.motivo === 'venda' && Number(m.quantidade) < 0 && String(m.referencia_externa).startsWith(pref))
      .map((m) => ({
        order_id: a.p_orders[0], lido_em: 'L', codigo_ref: String(m.referencia_externa).slice(pref.length), quantidade: -Number(m.quantidade),
        estornada: ms.some((e) => e.motivo === 'estorno_venda' && Number(e.quantidade) > 0 && e.referencia_externa === `estorno:${m.referencia_externa}`),
      }));
    return Promise.resolve({ data: ds.length ? ds : [{ order_id: a.p_orders[0], lido_em: 'L', codigo_ref: null, quantidade: null, estornada: false }], error: null });
  };
  // deno-lint-ignore no-explicit-any
  return { admin: { from, rpc } as any, lidas };
}
const ORG = 'org-1';
const venda = (ref: string, codigo: string, qtd = -1, criado_em = '2026-11-20T10:00:00.000001+00:00', org_id = ORG): Linha =>
  ({ org_id, motivo: 'venda', quantidade: qtd, codigo, referencia_externa: `mercado_livre:${ref}`, criado_em });
const estorno = (ref: string, qtd = 1, motivo = 'estorno_venda'): Linha =>
  ({ org_id: ORG, motivo, quantidade: qtd, codigo: 'x', referencia_externa: `estorno:mercado_livre:${ref}`, criado_em: '2026-11-21T10:00:00+00:00' });

describe('baixasAbertas', () => {
  it('só as abertas do pedido, com o código da referência e o do movimento (base do kit vinculado)', async () => {
    const { admin } = banco({ estoque_movimentos: [
      venda('12:KIT:01', 'BASE', -6), venda('12:B', 'B', -2), estorno('12:B', 2),
      venda('12:C', 'C'), estorno('12:C', 0, 'estorno_sku_nao_encontrado'),
      venda('123:D', 'D'), venda('12:E', 'E', -1, undefined, 'outra-org'),
    ] });
    expect(await baixasAbertas(admin, ORG, 12)).toEqual({
      abertas: [{ codigoRef: 'KIT:01', codigo: 'BASE', quantidade: 6 }, { codigoRef: 'C', codigo: 'C', quantidade: 1 }],
      haEstornada: true,
    });
  });
  it('sem baixa, ou tudo estornado: nenhuma aberta', async () => {
    expect(await baixasAbertas(banco({}).admin, ORG, 12)).toEqual({ abertas: [], haEstornada: false });
    expect(await baixasAbertas(banco({ estoque_movimentos: [venda('12:B', 'B'), estorno('12:B')] }).admin, ORG, 12))
      .toEqual({ abertas: [], haEstornada: true });
  });
  it('lança em erro da RPC ou do ledger, e se a baixa aberta não aparece no ledger', async () => {
    const t = { estoque_movimentos: [venda('12:B', 'B')] };
    for (const erro of ['cancelamento_baixas', 'estoque_movimentos']) {
      await expect(baixasAbertas(banco(t, erro).admin, ORG, 12), erro).rejects.toThrow(/fora/);
    }
    const { admin } = banco({});
    admin.rpc = () => Promise.resolve({ data: [{ codigo_ref: 'B', quantidade: 1, estornada: false }], error: null });
    await expect(baixasAbertas(admin, ORG, 12)).rejects.toThrow(/B/);
  });
});

describe('saldoMexidoDepois', () => {
  const ANTES = '2026-11-20T09:00:00+00:00';
  const DEPOIS = '2026-11-20T11:00:00+00:00';
  const mov = (motivo: string, codigo: string, criado_em: string, org_id = ORG): Linha => ({ org_id, motivo, codigo, criado_em, quantidade: 5, referencia_externa: 'm' });
  const com = (movs: Linha[], variacoes: Linha[] = [], baixa = venda('12:B', 'B')) =>
    saldoMexidoDepois(banco({ estoque_movimentos: [baixa, ...movs], variacoes }).admin, ORG, 12);

  it.each(['entrada', 'ajuste'])('%s do SKU depois da baixa trava; antes, de outro SKU ou de outra org, não', async (motivo) => {
    expect(await com([mov(motivo, 'B', DEPOIS)])).toBe(true);
    expect(await com([mov(motivo, 'B', ANTES)])).toBe(false);
    expect(await com([mov(motivo, 'Z', DEPOIS)])).toBe(false);
    expect(await com([mov(motivo, 'B', DEPOIS, 'outra-org')])).toBe(false);
  });
  it('outro motivo depois da baixa (venda, estorno) não trava', async () => {
    expect(await com([mov('venda', 'B', DEPOIS), mov('estorno_venda', 'B', DEPOIS)])).toBe(false);
  });
  it('linha de variacoes (planilha) criada depois trava; antes, de outro SKU ou de outra org, não', async () => {
    const v = (codigo: string, criado_em: string, org_id = ORG) => ({ org_id, codigo, criado_em });
    expect(await com([], [v('B', ANTES), v('B', DEPOIS)])).toBe(true);
    expect(await com([], [v('B', ANTES), v('Z', DEPOIS), v('B', DEPOIS, 'outra-org')])).toBe(false);
  });
  it('kit vinculado: olha a BASE (código do movimento), não o SKU vendido', async () => {
    const baixa = venda('12:KIT', 'BASE', -3);
    expect(await com([mov('entrada', 'BASE', DEPOIS)], [], baixa)).toBe(true);
    expect(await com([], [{ org_id: ORG, codigo: 'BASE', criado_em: DEPOIS }], baixa)).toBe(true);
    expect(await com([mov('entrada', 'KIT', DEPOIS)], [{ org_id: ORG, codigo: 'KIT', criado_em: DEPOIS }], baixa)).toBe(false);
  });
  it('olha todos os SKUs do pedido; venda sem saldo (quantidade 0) não é baixa', async () => {
    const t = (segunda: Linha) => ({ estoque_movimentos: [venda('12:B', 'B'), segunda, mov('entrada', 'C', DEPOIS)] });
    expect(await saldoMexidoDepois(banco(t(venda('12:C', 'C'))).admin, ORG, 12)).toBe(true);
    expect(await saldoMexidoDepois(banco(t(venda('12:C', 'C', 0))).admin, ORG, 12)).toBe(false);
  });
  it('prefixo exato: baixa do pedido 123 não entra na leitura do 12', async () => {
    const t = { estoque_movimentos: [venda('12:B', 'B'), venda('123:C', 'C'), mov('entrada', 'C', DEPOIS)] };
    expect(await saldoMexidoDepois(banco(t).admin, ORG, 12)).toBe(false);
  });
  it('`_` do prefixo não vale como curinga', async () => {
    const t = { estoque_movimentos: [venda('12:B', 'B'), { ...venda('x', 'C'), referencia_externa: 'mercadoXlivre:12:C' }, mov('entrada', 'C', DEPOIS)] };
    expect(await saldoMexidoDepois(banco(t).admin, ORG, 12)).toBe(false);
  });
  it('lança em erro de leitura e quando não acha a baixa (nunca "não mexido" por omissão)', async () => {
    const t = { estoque_movimentos: [venda('12:B', 'B')] };
    for (const erro of ['estoque_movimentos', 'variacoes']) {
      await expect(saldoMexidoDepois(banco(t, erro).admin, ORG, 12), erro).rejects.toThrow(/fora/);
    }
    await expect(saldoMexidoDepois(banco({}).admin, ORG, 12)).rejects.toThrow(/baixa/);
  });
});

describe('notificacaoJaEnviada', () => {
  const t = { ml_notificacoes_enviadas: [{ org_id: ORG, entidade: 'e', chave: '12' }] };
  it('por org, entidade e chave; lança em erro', async () => {
    expect(await notificacaoJaEnviada(banco(t).admin, ORG, 'e', '12')).toBe(true);
    expect(await notificacaoJaEnviada(banco(t).admin, ORG, 'e', '13')).toBe(false);
    expect(await notificacaoJaEnviada(banco(t).admin, ORG, 'f', '12')).toBe(false);
    expect(await notificacaoJaEnviada(banco(t).admin, 'o2', 'e', '12')).toBe(false);
    await expect(notificacaoJaEnviada(banco(t, 'ml_notificacoes_enviadas').admin, ORG, 'e', '12')).rejects.toThrow(/fora/);
  });
});

describe('filaAssume: só adia quando a fila do ADR-0211 vai mesmo drenar', () => {
  const ENV: { drenar: string | undefined; fanout: boolean } = { drenar: '1', fanout: true };
  const base = () => ({
    ml_vendas: [{ org_id: ORG, order_id: 12, cancelamento_geracao: 'g', cancelamento_concluido_em: null }] as Linha[],
    organizations: [{ id: ORG, arquivada_em: null }] as Linha[],
    marketplace_connections: [{ org_id: ORG, canal: 'mercado_livre', conta_externa_id: '999', criado_por: 'u' }] as Linha[],
  });
  const com = (over: Partial<ReturnType<typeof base>> = {}) => filaAssume(banco({ ...base(), ...over }).admin, ORG, 12, ENV);

  it('armada e pendente, drenagem e fan-out ligados, org ativa e conexão completa: assume', async () => {
    expect(await com()).toBe(true);
  });
  it.each([
    ['não armada', { ml_vendas: [{ org_id: ORG, order_id: 12, cancelamento_geracao: null, cancelamento_concluido_em: null }] }],
    ['já concluída', { ml_vendas: [{ org_id: ORG, order_id: 12, cancelamento_geracao: 'g', cancelamento_concluido_em: 't' }] }],
    ['venda de outra org', { ml_vendas: [{ org_id: 'o2', order_id: 12, cancelamento_geracao: 'g', cancelamento_concluido_em: null }] }],
    ['outro pedido', { ml_vendas: [{ org_id: ORG, order_id: 13, cancelamento_geracao: 'g', cancelamento_concluido_em: null }] }],
    ['org arquivada', { organizations: [{ id: ORG, arquivada_em: 't' }] }],
    ['org ausente', { organizations: [] }],
    ['sem conexão', { marketplace_connections: [] }],
    ['conexão sem conta', { marketplace_connections: [{ org_id: ORG, canal: 'mercado_livre', conta_externa_id: null, criado_por: 'u' }] }],
    ['conta vazia', { marketplace_connections: [{ org_id: ORG, canal: 'mercado_livre', conta_externa_id: '', criado_por: 'u' }] }],
    ['conexão sem dono', { marketplace_connections: [{ org_id: ORG, canal: 'mercado_livre', conta_externa_id: '9', criado_por: null }] }],
    ['conta e dono em linhas diferentes', { marketplace_connections: [
      { org_id: ORG, canal: 'mercado_livre', conta_externa_id: '9', criado_por: null },
      { org_id: ORG, canal: 'mercado_livre', conta_externa_id: null, criado_por: 'u' }] }],
    ['conexão de outro canal', { marketplace_connections: [{ org_id: ORG, canal: 'shopee', conta_externa_id: '9', criado_por: 'u' }] }],
  ])('%s: não assume', async (_n, over) => expect(await com(over)).toBe(false));
  it.each([
    ['drenagem desligada', { drenar: undefined, fanout: true }], ['drenagem por lista', { drenar: ORG, fanout: true }],
    ['fan-out desligado', { drenar: '1', fanout: false }],
  ])('%s: não assume, sem ler o banco', async (_n, env) => {
    const b = banco(base());
    expect(await filaAssume(b.admin, ORG, 12, env)).toBe(false);
    expect(b.lidas).toEqual([]);
  });
  it('erro em qualquer leitura lança (quem chama avisa)', async () => {
    for (const erro of ['ml_vendas', 'organizations', 'marketplace_connections']) {
      await expect(filaAssume(banco(base(), erro).admin, ORG, 12, ENV), erro).rejects.toThrow(/fora/);
    }
  });
});
