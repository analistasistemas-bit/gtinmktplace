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
import { criarAvaliador, depsLacoReajuste, depsPreview, ForaDaOrg, MSG_AGUARDANDO } from '../deps.ts';
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

  it('reivindicar: só a RPC (nada gravado aqui); ok → true, motivo/ocupado → false', async () => {
    const f = fakeAdmin(() => [], (_fn, a) => (a.p_ml_item === 'A' ? 'ok' : 'Família em publicação/atualização — tente depois'));
    const d = depsLacoReajuste(f.admin, OP, 'k');
    expect(await d.reivindicar('op', 'A')).toBe(true);
    expect(await d.reivindicar('op', 'B')).toBe(false);
    expect(f.rpcs.map(([fn]) => fn)).toEqual(['reajuste_reivindicar', 'reajuste_reivindicar']);
    expect(f.chamadas).toEqual([]);
  });

  it('agendarConferenciaItem: conferindo, n+1, backoff 5 → teto 60 min, etapa preservada', async () => {
    const f = fakeAdmin();
    const d = depsLacoReajuste(f.admin, OP, 'k');
    const antes = Date.now();
    await d.agendarConferenciaItem('op', 'A', 0);
    await d.agendarConferenciaItem('op', 'A', 9);
    const [[p0], [p9]] = f.chamadas.map((c) => op(c, 'update')[0]) as [[Record<string, unknown>], [Record<string, unknown>]];
    expect(p0).toMatchObject({ status: 'conferindo', conferencias: 1, mensagem: MSG_AGUARDANDO });
    expect(p9).toMatchObject({ conferencias: 10 });
    expect(p0).not.toHaveProperty('etapa');
    const min = (p: Record<string, unknown>) => Math.round((Date.parse(p.proxima_conferencia as string) - antes) / 60_000);
    expect([min(p0), min(p9)]).toEqual([5, 60]);
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

describe('depsPreview', () => {
  const cxT = { orgId: 'org', mlUserId: 'u', token: 't' };
  // MLB1 tem produto; MLB2 perdeu o produto (RPC null) e não é kit.
  const semProduto = () => fakeAdmin(() => [], (fn, a) => (fn === 'reajuste_codigo_pai' ? (a.p_ml_item === 'MLB1' ? 'P1' : null) : null));

  it('pedido do usuário com MLB sem produto → ForaDaOrg (400)', async () => {
    await expect(depsPreview(semProduto().admin, cxT, { reverter: false }).expandir([], ['MLB1', 'MLB2']))
      .rejects.toEqual(new ForaDaOrg(['MLB2']));
  });

  it('Reverter com 2 aplicados, um sem produto → rascunho com um elegível e um fora', async () => {
    const restaurar = (v: string) => [{ variacao_id: v, esperado: { preco_publicacao: 100, preco_editado_pelo_operador: false }, novo: { preco_publicacao: 110, preco_editado_pelo_operador: true } }];
    const origem = new Map([
      ['MLB1', { codigo_pai: 'P1', preco_anterior: 100, preco: 110, restaurar: restaurar('v1') }],
      ['MLB2', { codigo_pai: 'P2', preco_anterior: 100, preco: 110, restaurar: restaurar('v2') }],
    ]);
    const vivo = { preco: 110, variacoes: null, status: 'active', sub_status: [], catalog_listing: false, tem_relacoes: false };
    const r = await montarPreview({ familias: [], ml_item_ids: [], ajuste: null, origem_id: 'o' }, {
      expandir: depsPreview(semProduto().admin, cxT, { reverter: true }).expandir,
      origem: async () => origem,
      ml: { lerVivo: async () => vivo, putPreco: vi.fn(), participaPromocaoML: async () => false },
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
    expect(o?.get('MLB1')).toEqual({ codigo_pai: 'P1', preco_anterior: 100, preco: 110, restaurar });
    expect(op(f.chamadas[1], 'eq')).toEqual(expect.arrayContaining([['org_id', 'org'], ['status', 'aplicado']]));
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
