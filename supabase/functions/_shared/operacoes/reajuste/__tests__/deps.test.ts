import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fiação: Redis/QStash/ML mockados; o supabase é um gravador de chamadas.
const m = vi.hoisted(() => ({ tarifa: vi.fn(), aliq: vi.fn(), itemML: vi.fn() }));
vi.mock('../../../queue.ts', () => ({ qstashClient: vi.fn() }));
vi.mock('../../../redis/client.ts', () => ({ redisGet: vi.fn(), redisSet: vi.fn() }));
vi.mock('../../../promocoes/deps.ts', () => ({
  criarTarifaEm: () => m.tarifa,
  lerAliquotas: () => m.aliq(),
  carregarCadastro: async () => (await import('../../../promocoes/cadastro.ts')).montarCadastro([{
    id: 'v1', custo: 40, preco: 60, cor: 'Azul', codigo: 'SKU1', gtin: null, ml_variation_id: '11', peso_gramas: 100,
    altura_cm: 1, largura_cm: 1, comprimento_cm: 1, atualizado_em: null, familias: { ml_item_id: 'MLB1', origem: 'nacional' },
  }], []),
}));
vi.mock('../../../promocoes/ml.ts', async (orig) => ({
  ...(await orig<typeof import('../../../promocoes/ml.ts')>()),
  criarGetJson: () => vi.fn(),
  buscarItensML: async (_g: unknown, ids: string[]) => new Map(ids.map((id) => [id, m.itemML(id)])),
}));
import { criarAvaliador, depsLacoReajuste, depsPreview, depsReajuste, ForaDaOrg, MSG_AGUARDANDO } from '../deps.ts';
import { maiorOferta } from '../ofertas.ts';
import { montarPreview } from '../preview.ts';
import { linhasDoRascunho } from '../pedido.ts';
import { resumir } from '../avaliacao.ts';

type Op = [string, unknown[]];
type Chamada = { tabela: string; ops: Op[] };
function fakeAdmin(dados: (c: Chamada) => unknown = () => [], rpc: (fn: string, args: Record<string, unknown>) => unknown = () => null) {
  const chamadas: Chamada[] = [];
  const rpcs: [string, Record<string, unknown>][] = [];
  const builder = (c: Chamada): unknown => new Proxy({}, {
    get(_t, k) {
      if (k === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: dados(c), error: null }).then(res, rej);
      return (...args: unknown[]) => { c.ops.push([String(k), args]); return builder(c); };
    },
  });
  const admin = {
    from: (tabela: string) => { const c = { tabela, ops: [] }; chamadas.push(c); return builder(c); },
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push([fn, args]); return { data: rpc(fn, args), error: null }; },
  };
  return { admin: admin as never, chamadas, rpcs };
}
const op = (c: Chamada, nome: string) => c.ops.filter(([n]) => n === nome).map(([, a]) => a);
const OP = { id: 'op', org_id: 'org' };

describe('depsLacoReajuste', () => {
  it('itensAConferir olha `conferindo` com proxima_conferencia (não saida_solicitada), sempre por org', async () => {
    const f = fakeAdmin();
    await depsLacoReajuste(f.admin, OP, 'k').itensAConferir('op');
    const c = f.chamadas[0];
    expect(op(c, 'eq')).toEqual(expect.arrayContaining([['org_id', 'org'], ['operacao_id', 'op'], ['status', 'conferindo']]));
    expect(op(c, 'not')).toEqual([['proxima_conferencia', 'is', null]]);
  });

  it('itensPendentes: pendente ∪ conferindo vencido ∪ enviando parado', async () => {
    const f = fakeAdmin();
    await depsLacoReajuste(f.admin, OP, 'k').itensPendentes('op', 20);
    const [[filtro]] = op(f.chamadas[0], 'or') as [[string]];
    expect(filtro).toMatch(/^status\.eq\.pendente,and\(status\.eq\.conferindo,proxima_conferencia\.lte\.[^)]+\),and\(status\.eq\.enviando,atualizado_em\.lt\.[^)]+\)$/);
    expect(op(f.chamadas[0], 'eq')).toContainEqual(['org_id', 'org']);
  });

  it('reivindicar: só a RPC (nada gravado aqui); ok → token, motivo/ocupado → null', async () => {
    const f = fakeAdmin(() => [], (_fn, a) => (a.p_ml_item === 'A' ? 'ok:token' : 'Família em publicação/atualização — tente depois'));
    const d = depsLacoReajuste(f.admin, OP, 'k');
    expect(await d.reivindicar('op', 'A')).toBe('token');
    expect(await d.reivindicar('op', 'B')).toBeNull();
    expect(f.rpcs.map(([fn]) => fn)).toEqual(['reajuste_reivindicar', 'reajuste_reivindicar']);
    expect(f.chamadas).toEqual([]);
  });

  it('agendarConferenciaItem: pela RPC com token; conferindo, n+1, backoff 5 → teto 60 min, etapa preservada', async () => {
    const f = fakeAdmin(() => [], () => true);
    const d = depsLacoReajuste(f.admin, OP, 'k');
    const antes = Date.now();
    expect(await d.agendarConferenciaItem('op', 'A', 'tk', 0)).toBe(true);
    await d.agendarConferenciaItem('op', 'A', 'tk', 9);
    expect(f.chamadas).toEqual([]);
    expect(f.rpcs[0]).toEqual(['reajuste_item_gravar', expect.objectContaining({ p_org: 'org', p_operacao: 'op', p_ml_item: 'A', p_token: 'tk' })]);
    const [p0, p9] = f.rpcs.map(([, a]) => a.p_campos) as [Record<string, unknown>, Record<string, unknown>];
    expect(p0).toMatchObject({ status: 'conferindo', conferencias: 1, mensagem: MSG_AGUARDANDO });
    expect(p9).toMatchObject({ conferencias: 10 });
    expect(p0).not.toHaveProperty('etapa');
    const min = (p: Record<string, unknown>) => Math.round((Date.parse(p.proxima_conferencia as string) - antes) / 60_000);
    expect([min(p0), min(p9)]).toEqual([5, 60]);
  });

  it('gravarItem: pela RPC com token; false = sem posse', async () => {
    const f = fakeAdmin(() => [], () => false);
    const campos = { status: 'erro', mensagem: 'x' } as const;
    expect(await depsLacoReajuste(f.admin, OP, 'k').gravarItem('op', 'A', 'tk', campos)).toBe(false);
    expect(f.chamadas).toEqual([]);
    expect(f.rpcs).toEqual([['reajuste_item_gravar', { p_org: 'org', p_operacao: 'op', p_ml_item: 'A', p_token: 'tk', p_campos: campos }]]);
  });

  it('encerrarSemEtapa: sem etapa → erro; com etapa → conferindo agendado (inclui conferindo vencido)', async () => {
    const f = fakeAdmin();
    await depsLacoReajuste(f.admin, OP, 'k').encerrarSemEtapa('op', 'reconecte');
    const [semEtapa, comEtapa] = f.chamadas;
    expect(op(semEtapa, 'update')[0][0]).toMatchObject({ status: 'erro', mensagem: 'reconecte' });
    expect(op(semEtapa, 'in')).toEqual([['status', ['pendente', 'enviando']]]);
    expect(op(semEtapa, 'is')).toEqual([['etapa', null]]);
    const p = op(comEtapa, 'update')[0][0] as Record<string, unknown>;
    expect(p).toMatchObject({ status: 'conferindo', mensagem: 'reconecte' });
    expect(Date.parse(p.proxima_conferencia as string)).toBeGreaterThan(Date.now());
    expect(op(comEtapa, 'not')).toEqual([['etapa', 'is', null]]);
    expect(String(op(comEtapa, 'or')[0][0])).toMatch(/^status\.in\.\(pendente,enviando\),and\(status\.eq\.conferindo,proxima_conferencia\.lte\./);
  });
});

describe('depsReajuste', () => {
  const cxT = { orgId: 'org', mlUserId: 'u', token: 't' };
  const opRow = { id: 'op', org_id: 'org', origem_id: null };

  it('marcarPasso: RPC com token e índice', async () => {
    const f = fakeAdmin(() => [], () => true);
    expect(await depsReajuste(f.admin, cxT, opRow, 'k').marcarPasso('op', 'A', 'tk', 1, 'confirmado')).toBe(true);
    expect(f.rpcs).toEqual([['reajuste_passo_marcar', { p_org: 'org', p_operacao: 'op', p_ml_item: 'A', p_token: 'tk', p_indice: 1, p_estado: 'confirmado' }]]);
  });

  it('persistir: RPC com token e mensagem; sem_posse volta como veio', async () => {
    const f = fakeAdmin(() => [], () => 'sem_posse');
    expect(await depsReajuste(f.admin, cxT, opRow, 'k').persistir('op', 'A', 'tk', 110, [], 'aviso')).toBe('sem_posse');
    expect(f.rpcs).toEqual([['reajuste_persistir', {
      p_org: 'org', p_operacao: 'op', p_ml_item: 'A', p_token: 'tk', p_preco_confirmado: 110, p_restaurar: [], p_mensagem: 'aviso',
    }]]);
  });

  it('configAtacado: mesma herança do preview', async () => {
    const faixas = [{ min_unidades: 3, desconto_pct: 10 }];
    const f = fakeAdmin(() => [{ atacado: null, familias: { atacado: faixas } }]);
    expect(await depsReajuste(f.admin, cxT, opRow, 'k').configAtacado(['v1'])).toEqual({ faixas, divergente: false });
    expect(op(f.chamadas[0], 'eq')).toContainEqual(['org_id', 'org']);
  });

  it('lerItem traz passos e avaliacoes', async () => {
    const passos = [{ tipo: 'base', anterior: 100, alvo: 110, estado: 'pendente' }];
    const avaliacoes = [{ tipo: 'base', chave: 'base', preco: 110, avaliacao: null }];
    const f = fakeAdmin(() => ({ preco: '110', preco_anterior: '100', conferencias: 2, passos, avaliacoes }));
    const i = await depsReajuste(f.admin, cxT, opRow, 'k').lerItem('op', 'A');
    expect(i).toMatchObject({ preco: 110, preco_anterior: 100, passos, avaliacoes });
    expect(String(op(f.chamadas[0], 'select')[0][0])).toMatch(/\bpassos\b.*\bavaliacoes\b|\bavaliacoes\b.*\bpassos\b/);
  });

  it('lerItem sem passos → listas vazias', async () => {
    const f = fakeAdmin(() => ({ preco: 110, preco_anterior: 100 }));
    expect(await depsReajuste(f.admin, cxT, opRow, 'k').lerItem('op', 'A')).toMatchObject({ passos: [], avaliacoes: [] });
  });
});

describe('depsPreview', () => {
  const cxT = { orgId: 'org', mlUserId: 'u', token: 't' };
  // MLB1 tem produto; MLB2 perdeu o produto (RPC null) e não é kit.
  const semProduto = () => fakeAdmin(() => [], (fn, a) => (fn === 'reajuste_codigo_pai' ? (a.p_ml_item === 'MLB1' ? 'P1' : null) : null));

  it('origem traz os passos do item', async () => {
    const passos = [{ tipo: 'base', anterior: 100, alvo: 110, estado: 'confirmado' }];
    const f = fakeAdmin((c) => (c.tabela === 'operacoes_massa' ? { id: 'o' }
      : [{ ml_item_id: 'A', preco: 110, preco_anterior: 100, passos }, { ml_item_id: 'B', preco: 110, preco_anterior: 100, passos: null }]));
    const o = await depsPreview(f.admin, cxT, { reverter: true }).origem('o');
    expect(o?.get('A')?.passos).toEqual(passos);
    expect(o?.get('B')?.passos).toEqual([]);
  });

  it('pedido do usuário com MLB sem produto → ForaDaOrg (400)', async () => {
    await expect(depsPreview(semProduto().admin, cxT, { reverter: false }).expandir([], ['MLB1', 'MLB2']))
      .rejects.toEqual(new ForaDaOrg(['MLB2']));
  });

  it('Reverter com 2 aplicados, um sem produto → rascunho com um elegível e um fora', async () => {
    const restaurar = (v: string) => [{ variacao_id: v, esperado: { preco_publicacao: 100, preco_editado_pelo_operador: false }, novo: { preco_publicacao: 110, preco_editado_pelo_operador: true } }];
    const origem = new Map([
      ['MLB1', { codigo_pai: 'P1', preco_anterior: 100, preco: 110, restaurar: restaurar('v1'), passos: [] }],
      ['MLB2', { codigo_pai: 'P2', preco_anterior: 100, preco: 110, restaurar: restaurar('v2'), passos: [] }],
    ]);
    const vivo = { preco: 110, variacoes: null, status: 'active', sub_status: [], catalog_listing: false, tem_relacoes: false };
    const r = await montarPreview({ familias: [], ml_item_ids: [], ajuste: null, origem_id: 'o' }, {
      expandir: depsPreview(semProduto().admin, cxT, { reverter: true }).expandir,
      origem: async () => origem,
      ml: { lerVivo: async () => vivo, putPreco: vi.fn(), lerOfertas: async () => [], lerFaixas: async () => [], gravarFaixas: vi.fn() },
      configAtacado: async () => ({ faixas: null, divergente: false }),
      ofertasBanco: async (ids) => new Map(ids.map((id) => [id, []])),
      variacoesDoMlb: async () => [{ ml_variation_id: '', variacao_id: 'v1' }],
      estadoVariacoes: async () => new Map([['v1', { preco_publicacao: 110, preco_editado_pelo_operador: true }]]),
      avaliar: async () => resumir([]),
    });
    expect(r).toMatchObject({ ok: true, executaveis: 1 });
    const itens = r.ok ? r.itens : [];
    expect(itens.map((i) => [i.ml_item_id, i.situacao])).toEqual([['MLB1', 'elegivel'], ['MLB2', 'fora']]);
    expect(itens[1].motivo).toBe('Anúncio não encontrado no cadastro');
    expect(linhasDoRascunho(itens).map((l) => [l.status, l.codigo_pai])).toEqual([['rascunho', 'P1'], ['bloqueado', 'P2']]);
  });

  it('configAtacado: cada cor herda da própria família, filtrando por org', async () => {
    const cinco = [{ min_unidades: 2, desconto_pct: 5 }];
    const f = fakeAdmin(() => [{ atacado: null, familias: { atacado: cinco } }, { atacado: cinco, familias: { atacado: null } }]);
    expect(await depsPreview(f.admin, cxT, { reverter: false }).configAtacado(['v1', 'v2'])).toEqual({ faixas: cinco, divergente: false });
    expect(f.chamadas[0].tabela).toBe('variacoes');
    expect(op(f.chamadas[0], 'eq')).toContainEqual(['org_id', cxT.orgId]);
    expect(op(f.chamadas[0], 'in')).toEqual([['id', ['v1', 'v2']]]);
  });

  it('configAtacado: famílias com atacado diferente divergem', async () => {
    const f = fakeAdmin(() => [{ atacado: null, familias: { atacado: [{ min_unidades: 2, desconto_pct: 5 }] } }, { atacado: null, familias: { atacado: null } }]);
    expect((await depsPreview(f.admin, cxT, { reverter: false }).configAtacado(['v1', 'v2'])).divergente).toBe(true);
  });

  it('variacoesDoMlb não descarta linhas (plano/UP: ml_variation_id null → "")', async () => {
    const f = fakeAdmin(() => [], () => [{ ml_variation_id: null, variacao_id: 'v1' }, { ml_variation_id: '2', variacao_id: null }]);
    const d = depsPreview(f.admin, { orgId: 'org', mlUserId: 'u', token: 't' }, { reverter: false });
    expect(await d.variacoesDoMlb('P', 'MLB1', ['2'])).toEqual([{ ml_variation_id: '', variacao_id: 'v1' }, { ml_variation_id: '2', variacao_id: null }]);
    expect(f.rpcs[0]).toEqual(['reajuste_variacoes_do_mlb', { p_org: 'org', p_codigo_pai: 'P', p_ml_item: 'MLB1', p_ml_variation_ids: ['2'] }]);
  });

  it('origem devolve codigo_pai e restaurar dos itens aplicados', async () => {
    const restaurar = [{ variacao_id: 'v1', esperado: { preco_publicacao: 100, preco_editado_pelo_operador: false }, novo: { preco_publicacao: 110, preco_editado_pelo_operador: true } }];
    const f = fakeAdmin((c) => (c.tabela === 'operacoes_massa' ? { id: 'o' }
      : [{ ml_item_id: 'MLB1', codigo_pai: 'P1', preco: '110', preco_anterior: '100', estado_anterior: restaurar }]));
    const o = await depsPreview(f.admin, { orgId: 'org', mlUserId: 'u', token: 't' }, { reverter: false }).origem('o');
    expect(o?.get('MLB1')).toEqual({ codigo_pai: 'P1', preco_anterior: 100, preco: 110, passos: [], restaurar });
    expect(op(f.chamadas[1], 'eq')).toEqual(expect.arrayContaining([['org_id', 'org'], ['status', 'aplicado']]));
  });
});

describe('ofertasBanco', () => {
  const cx = { orgId: 'org', mlUserId: 'u', token: 't' };
  const haMin = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const campanha = (status: string) => ({ tipo: 'DEAL', status, inicio: '2026-11-01T00:00:00+00:00', fim: '2026-11-30T00:00:00+00:00' });
  const promo = (o: Record<string, unknown> = {}) => ({
    org_id: 'org', promocao_id: 'P1', ml_item_id: 'MLB1', status: 'started', preco_promo: '39.90', anuncio_normal_id: null, ml_promocoes: campanha('started'), ...o,
  });
  const operacao = (o: Record<string, unknown> = {}) => ({
    org_id: 'org', promocao_id: 'P2', ml_item_id: 'MLB1', status: 'aplicado', etapa: null, preco: '45.50', offer_id: null, atualizado_em: haMin(5),
    operacoes_massa: { acao: 'aderir', promocao_tipo: 'DEAL' }, ...o,
  });
  const filtro = (c: Chamada, coluna: string) => (op(c, 'in') as [string, string[]][]).find(([col]) => col === coluna)?.[1];
  // Aplica os filtros gravados: o teste prova o efeito no resultado, não só a chamada.
  const banco = (promos: Record<string, unknown>[], ops: Record<string, unknown>[] = []) => fakeAdmin((c) => {
    const daOrg = (r: Record<string, unknown>) => (op(c, 'eq') as [string, unknown][]).some(([col, v]) => col === 'org_id' && v === r.org_id);
    const normais = filtro(c, 'anuncio_normal_id');
    if (normais) return promos.filter((r) => daOrg(r) && normais.includes(r.anuncio_normal_id as string));
    const ids = filtro(c, 'ml_item_id') ?? [];
    if (c.tabela === 'operacoes_massa_itens') {
      const [[, desde]] = op(c, 'gt') as [[string, string]];
      const [[ou]] = op(c, 'or') as [[string]];
      const etapa = /etapa\.eq\.(\w+)/.exec(ou)?.[1];
      const status = /status\.in\.\(([^)]*)\)/.exec(ou)?.[1].split(',') ?? [];
      return ops.filter((r) => daOrg(r) && ids.includes(r.ml_item_id as string) && (r.atualizado_em as string) > desde
        && filtro(c, 'operacoes_massa.acao')?.includes((r.operacoes_massa as { acao: string }).acao)
        && (r.etapa === etapa || status.includes(r.status as string)));
    }
    return promos.filter((r) => daOrg(r) && ids.includes(r.ml_item_id as string) && filtro(c, 'status')?.includes(r.status as string)
      && filtro(c, 'ml_promocoes.status')?.includes((r.ml_promocoes as { status: string }).status));
  });
  const ler = (f: ReturnType<typeof banco>, ids = ['MLB1']) => depsPreview(f.admin, cx, { reverter: false }).ofertasBanco(ids);

  it('oferta da Central entra com o preço do banco; id sem oferta vem vazio', async () => {
    const f = banco([promo()]);
    const r = await ler(f, ['MLB1', 'MLB2']);
    expect(r.get('MLB1')).toEqual([{
      chave: 'P1:2026-11-01T00:00:00+00:00', promocao_id: 'P1', tipo: 'DEAL', status: 'started', preco: 39.9, offer_id: null,
      inicio: '2026-11-01T00:00:00+00:00', fim: '2026-11-30T00:00:00+00:00',
    }]);
    expect(r.get('MLB2')).toEqual([]);
    for (const c of f.chamadas) expect(op(c, 'eq')).toContainEqual(['org_id', 'org']);
  });

  it("campanha 'finished' e item candidate não entram", async () => {
    const r = await ler(banco([promo({ ml_promocoes: campanha('finished') }), promo({ promocao_id: 'P3', status: 'candidate' })]));
    expect(r.get('MLB1')).toEqual([]);
  });

  it('par de catálogo: oferta e operação da linha do catálogo valem para o normal pedido', async () => {
    const pares = [promo({ ml_item_id: 'MLBCAT', anuncio_normal_id: 'MLB1' }), promo({ promocao_id: 'P9', ml_item_id: 'MLBCAT', anuncio_normal_id: 'MLB1', status: 'candidate' })];
    const r = await ler(banco(pares, [operacao({ ml_item_id: 'MLBCAT', etapa: 'escrita_pedida', status: 'erro' })]));
    expect(r.get('MLB1')?.map((o) => o.promocao_id).sort()).toEqual(['P1', 'P2']);
    expect([...r.keys()]).toEqual(['MLB1']);
  });

  it("aderir 'aplicado' há 5 min entra com o preço gravado; há 40 min não", async () => {
    const r = await ler(banco([], [operacao(), operacao({ promocao_id: 'P3', atualizado_em: haMin(40) })]));
    expect(r.get('MLB1')).toMatchObject([{ chave: 'P2:pending', promocao_id: 'P2', tipo: 'DEAL', status: 'pending', preco: 45.5 }]);
  });

  it("aderir 'erro' com etapa escrita_pedida há 5 min → preço null → maiorOferta null", async () => {
    const r = await ler(banco([promo()], [operacao({ status: 'erro', etapa: 'escrita_pedida' })]));
    expect(r.get('MLB1')).toHaveLength(2);
    expect(maiorOferta(r.get('MLB1')!)).toBeNull();
  });

  it("aderir 'ja_estava' há 5 min, com a Central desatualizada → preço null → maiorOferta null", async () => {
    const r = await ler(banco([promo({ status: 'candidate' })], [operacao({ status: 'ja_estava' })]));
    expect(r.get('MLB1')).toMatchObject([{ promocao_id: 'P2', preco: null }]);
    expect(maiorOferta(r.get('MLB1')!)).toBeNull();
  });

  it('não entram: outra ação, status sem escrita, outra org', async () => {
    const sair = { operacoes_massa: { acao: 'sair', promocao_tipo: 'DEAL' } };
    const r = await ler(banco([promo({ org_id: 'outra' })], [
      operacao(sair), operacao({ ...sair, status: 'erro', etapa: 'escrita_pedida' }),
      operacao({ operacoes_massa: { acao: 'reajustar', promocao_tipo: null } }),
      operacao({ status: 'pendente' }), operacao({ status: 'erro' }), operacao({ status: 'mudou', etapa: 'ml_confirmado' }),
      operacao({ org_id: 'outra' }),
    ]));
    expect(r.get('MLB1')).toEqual([]);
  });

  it('mesma oferta em duas operações: uma só, com o maior preço', async () => {
    const r = await ler(banco([], [operacao({ offer_id: 'OFFER-1', preco: '41' }), operacao({ offer_id: 'OFFER-1', preco: '43' })]));
    expect(r.get('MLB1')?.map((o) => o.preco)).toEqual([43]);
  });

  it('operações: só aderir/alterar_preco, com aplicado, ja_estava ou escrita pedida', async () => {
    const f = banco([]);
    await ler(f);
    const c = f.chamadas.find((x) => x.tabela === 'operacoes_massa_itens')!;
    expect(filtro(c, 'operacoes_massa.acao')).toEqual(['aderir', 'alterar_preco']);
    expect(op(c, 'or')).toEqual([['etapa.eq.escrita_pedida,status.in.(aplicado,ja_estava)']]);
  });

  it('mais de 1000 linhas: pagina até o fim', async () => {
    const pagina = Array.from({ length: 1000 }, (_, i) => promo({ promocao_id: `P${i}` }));
    const f = fakeAdmin((c) => {
      if (filtro(c, 'anuncio_normal_id') || c.tabela !== 'ml_promocao_itens') return [];
      const [[de]] = op(c, 'range') as [[number]];
      return de === 0 ? pagina : [promo({ promocao_id: 'ULTIMA' })];
    });
    expect((await ler(f)).get('MLB1')).toHaveLength(1001);
  });
});

describe('criarAvaliador', () => {
  const cx = { orgId: 'org', mlUserId: 'u', token: 't' };
  beforeEach(() => {
    vi.resetAllMocks();
    m.aliq.mockResolvedValue({ nacional: 8, importado: 16 });
    m.itemML.mockImplementation((id: string) => ({
      id, titulo: null, thumbnail: null, permalink: null, listing_type_id: 'gold_special', categoria: 'MLB1', sku: null, gtin: null,
      unidades: null, formato_kit: false, variacoes: [{ variation_id: 11, cor: 'Azul', sku: 'SKU1', gtin: null }],
    }));
  });

  it('tarifa estimada → ⚪ (nunca lança)', async () => {
    m.tarifa.mockRejectedValue(new Error('comissão estimada'));
    const a = await criarAvaliador(fakeAdmin().admin, cx)('MLB1', 100);
    expect(a).toMatchObject({ pior: 'indisponivel', tem_sem_dado: true, tem_vermelho: false });
    expect(a.cores[0]).toMatchObject({ variation_id: '11', motivo: 'erro_tarifa', semaforo: 'indisponivel' });
  });

  it('com tarifa: cor avaliada com variation_id em texto', async () => {
    m.tarifa.mockResolvedValue({ comissao: { percentual: 10, fixa: 0 }, frete: 0 });
    const a = await criarAvaliador(fakeAdmin().admin, cx)('MLB1', 100);
    expect(a.cores[0]).toMatchObject({ variation_id: '11', custo: 40, piso: 60, origem: 'nacional', aliquota_pct: 8, comissao_pct: 10, semaforo: 'verde' });
  });

  it('sem alíquotas → ⚪', async () => {
    m.aliq.mockResolvedValue(null);
    expect(await criarAvaliador(fakeAdmin().admin, cx)('MLB1', 100)).toMatchObject({ pior: 'indisponivel', tem_sem_dado: true });
  });
});
