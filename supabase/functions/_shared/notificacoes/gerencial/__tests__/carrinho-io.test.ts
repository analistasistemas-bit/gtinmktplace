import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  log: [] as string[],
  publishJSON: vi.fn(),
  batchJSON: vi.fn(),
  temAssinanteGerencial: vi.fn(),
  notificarCategoria: vi.fn(),
  lerVendasDoCarrinho: vi.fn(),
  carregarContexto: vi.fn(),
  lerKpis: vi.fn(),
  resultadoPorItem: vi.fn(),
  resultadoCarrinho: vi.fn(),
  montarMensagemCarrinho: vi.fn(),
  resolverConexao: vi.fn(),
  getValidAccessTokenConexao: vi.fn(),
}));

vi.mock('../../../queue.ts', () => ({ qstashClient: () => ({ publishJSON: m.publishJSON, batchJSON: m.batchJSON }) }));
vi.mock('../../config.ts', () => ({ temAssinanteGerencial: m.temAssinanteGerencial, notificarCategoria: m.notificarCategoria }));
vi.mock('../../../platform-admin/metrics-repository.ts', () => ({
  lerVendasDoCarrinho: m.lerVendasDoCarrinho, carregarContexto: m.carregarContexto,
}));
vi.mock('../kpis.ts', () => ({ lerKpis: m.lerKpis }));
vi.mock('../resultado.ts', () => ({ resultadoPorItem: m.resultadoPorItem, resultadoCarrinho: m.resultadoCarrinho }));
vi.mock('../mensagens.ts', () => ({ montarMensagemCarrinho: m.montarMensagemCarrinho }));
vi.mock('../../../canais/conexao.ts', () => ({ resolverConexao: m.resolverConexao }));
vi.mock('../../../ml/token.ts', () => ({ getValidAccessTokenConexao: m.getValidAccessTokenConexao }));

import { buscarOrdersDoPack, processarCarrinho, registrarCarrinho, varrerCarrinhos } from '../carrinho-io.ts';

type Linha = Record<string, any>;
interface Op { op: 'select' | 'upsert' | 'update'; row?: Linha; opts?: unknown; patch?: Linha; is: Array<[string, unknown]>; or?: string; range?: [number, number] }

// Tabela notificacao_carrinho em memória: aplica eq/is/lt e devolve as linhas afetadas.
function fakeAdmin(linhas: Linha[]) {
  const ops: Op[] = [];
  const admin: any = {
    linhas, ops,
    from: (tabela: string) => {
      if (tabela !== 'notificacao_carrinho') throw new Error(`tabela inesperada ${tabela}`);
      const st: Op = { op: 'select', is: [] };
      const filtros: Array<(r: Linha) => boolean> = [];
      const run = () => {
        ops.push(st);
        if (st.op === 'upsert') {
          const r = st.row!;
          if (linhas.some((l) => l.org_id === r.org_id && l.chave === r.chave)) return { data: [], error: null };
          const nova = { status: 'aguardando', tentativas: 0, atualizado_em: new Date().toISOString(), ...r };
          linhas.push(nova);
          return { data: [nova], error: null };
        }
        const alvo = linhas.filter((l) => filtros.every((f) => f(l)));
        if (st.op === 'update') {
          m.log.push(`update:${JSON.stringify(st.patch)}`);
          alvo.forEach((l) => Object.assign(l, st.patch));
          return { data: alvo, error: null };
        }
        const ord = [...alvo].sort((a, b) => (a.org_id + a.chave).localeCompare(b.org_id + b.chave));
        return { data: st.range ? ord.slice(st.range[0], st.range[1] + 1) : ord, error: null };
      };
      const c: any = {
        select: () => c,
        eq: (k: string, v: unknown) => { filtros.push((r) => r[k] === v); return c; },
        is: (k: string, v: unknown) => { st.is.push([k, v]); filtros.push((r) => (v === null ? r[k] == null : r[k] === v)); return c; },
        lt: (k: string, v: string) => { filtros.push((r) => r[k] < v); return c; },
        or: (s: string) => { st.or = s; return c; },
        order: () => c,
        range: (a: number, b: number) => { st.range = [a, b]; return c; },
        upsert: (row: Linha, opts: unknown) => { st.op = 'upsert'; st.row = row; st.opts = opts; return c; },
        update: (patch: Linha) => { st.op = 'update'; st.patch = patch; return c; },
        maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: null }; },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return c;
    },
  };
  return admin;
}

const ORG = 'org-1';
const fetchMock = vi.fn();
const packOk = (ids: number[]) => ({ ok: true, json: async () => ({ id: 9000, orders: ids.map((id) => ({ id })) }) });
const pedido = (extra: Linha = {}) => ({ id: 1, status: 'paid', pack_id: 9000, date_closed: new Date().toISOString(), ...extra });

beforeEach(() => {
  vi.resetAllMocks();
  m.log.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Deno', { env: { get: () => 'https://proj.supabase.co' } });
  m.temAssinanteGerencial.mockResolvedValue(true);
  m.publishJSON.mockResolvedValue({ messageId: 'm1' });
  m.batchJSON.mockImplementation(async (msgs: unknown[]) => msgs.map(() => ({ messageId: 'x' })));
  m.notificarCategoria.mockImplementation(async () => { m.log.push('notificar'); return 1; });
});
afterEach(() => vi.unstubAllGlobals());

describe('buscarOrdersDoPack', () => {
  it('lê orders[].id de GET /packs/{id}', async () => {
    fetchMock.mockResolvedValue(packOk([11, 12]));
    await expect(buscarOrdersDoPack('tok', 9000)).resolves.toEqual([11, 12]);
    expect(fetchMock).toHaveBeenCalledWith('https://api.mercadolibre.com/packs/9000', { headers: { Authorization: 'Bearer tok' } });
  });
  it('HTTP de erro, formato inesperado ou falha de rede → null', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(buscarOrdersDoPack('tok', 9000)).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ orders: 'x' }) });
    await expect(buscarOrdersDoPack('tok', 9000)).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ orders: [{ id: 'abc' }] }) });
    await expect(buscarOrdersDoPack('tok', 9000)).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ orders: [] }) });
    await expect(buscarOrdersDoPack('tok', 9000)).resolves.toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('rede'));
    await expect(buscarOrdersDoPack('tok', 9000)).resolves.toBeNull();
  });
});

describe('registrarCarrinho', () => {
  it('pago + assinante: upsert ignoreDuplicates e QStash com delay 20 e dedup da tentativa', async () => {
    fetchMock.mockResolvedValue(packOk([1, 2]));
    const admin = fakeAdmin([]);
    await registrarCarrinho(admin, 'tok', ORG, pedido());
    const up = admin.ops.find((o: Op) => o.op === 'upsert');
    expect(up.opts).toEqual({ onConflict: 'org_id,chave', ignoreDuplicates: true });
    expect(up.row).toMatchObject({ org_id: ORG, chave: '9000', pack_id: 9000, order_id: 1, esperadas: [1, 2] });
    expect(m.publishJSON).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://proj.supabase.co/functions/v1/notificar-carrinho',
      body: { orgId: ORG, chave: '9000' }, delay: 20, deduplicationId: `carrinho-${ORG}-9000-0`,
    }));
  });

  it('pedido sem pack: esperadas = [order], sem /packs', async () => {
    const admin = fakeAdmin([]);
    await registrarCarrinho(admin, 'tok', ORG, pedido({ id: 77, pack_id: null }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.linhas[0]).toMatchObject({ chave: '77', pack_id: null, order_id: 77, esperadas: [77] });
  });

  it('2ª chamada com linha aguardando e esperadas null: tenta /packs e só preenche se continuar null', async () => {
    fetchMock.mockResolvedValue(packOk([1, 2]));
    const admin = fakeAdmin([{ org_id: ORG, chave: '9000', pack_id: 9000, order_id: 1, esperadas: null, status: 'aguardando', tentativas: 0 }]);
    await registrarCarrinho(admin, 'tok', ORG, pedido({ id: 2 }));
    const upd = admin.ops.find((o: Op) => o.op === 'update');
    expect(upd.patch).toMatchObject({ esperadas: [1, 2] });
    expect(upd.is).toContainEqual(['esperadas', null]);
    expect(admin.linhas[0].esperadas).toEqual([1, 2]);
    expect(admin.ops.some((o: Op) => o.op === 'upsert')).toBe(false);
    expect(m.publishJSON).not.toHaveBeenCalled();
  });

  it('falha ao publicar não lança e a linha fica aguardando (varredura recupera)', async () => {
    fetchMock.mockResolvedValue(packOk([1, 2]));
    m.publishJSON.mockRejectedValue(new Error('qstash fora'));
    const admin = fakeAdmin([]);
    await expect(registrarCarrinho(admin, 'tok', ORG, pedido())).resolves.toBeUndefined();
    expect(admin.linhas[0].status).toBe('aguardando');
  });

  it('cancelado, sem assinante, erro ao ler assinantes ou pagamento além do prazo → nenhuma escrita', async () => {
    const admin = fakeAdmin([]);
    await registrarCarrinho(admin, 'tok', ORG, pedido({ status: 'cancelled' }));
    m.temAssinanteGerencial.mockResolvedValueOnce(false);
    await registrarCarrinho(admin, 'tok', ORG, pedido());
    m.temAssinanteGerencial.mockRejectedValueOnce(new Error('db'));
    await expect(registrarCarrinho(admin, 'tok', ORG, pedido())).resolves.toBeUndefined();
    // re-sync de pedido antigo (webhook de envio): o teto de 600 s já passou
    await registrarCarrinho(admin, 'tok', ORG, pedido({ date_closed: new Date(Date.now() - 601_000).toISOString() }));
    expect(admin.ops).toEqual([]);
    expect(m.publishJSON).not.toHaveBeenCalled();
  });
});

const P0 = '2026-10-24T17:00:00.000Z';
const mais = (s: number) => new Date(Date.parse(P0) + s * 1000);
const linha = (extra: Linha = {}): Linha => ({
  org_id: ORG, chave: '9000', pack_id: 9000, order_id: 1, esperadas: [1, 2], primeiro_em: P0,
  status: 'aguardando', tentativas: 0, atualizado_em: P0, ...extra,
});
const venda = (order_id: number, status = 'paid') => ({ id: `v${order_id}`, order_id, pack_id: 9000, status, date_closed: '2026-10-24T16:59:00.000Z', itens: [] });
const KPI = { faturamento: 100, pedidos: 1, ticket: 100 };

function prepararEnvio() {
  m.carregarContexto.mockResolvedValue({ configOk: true });
  m.resultadoPorItem.mockReturnValue([]);
  m.resultadoCarrinho.mockReturnValue({ venda: 100 });
  m.lerKpis.mockResolvedValue(KPI);
  m.montarMensagemCarrinho.mockReturnValue('TEXTO');
}

describe('processarCarrinho', () => {
  it('linha já enviada (ou inexistente) → ignorado', async () => {
    expect(await processarCarrinho(fakeAdmin([linha({ status: 'enviado' })]), ORG, '9000', mais(20))).toBe('ignorado');
    expect(await processarCarrinho(fakeAdmin([]), ORG, '9000', mais(20))).toBe('ignorado');
    expect(m.notificarCategoria).not.toHaveBeenCalled();
  });

  it('enviar: lê tudo, marca enviado (condicional) ANTES de notificar e manda vendas_gerencial', async () => {
    prepararEnvio();
    m.lerVendasDoCarrinho.mockResolvedValue([venda(1), venda(2)]);
    const admin = fakeAdmin([linha()]);
    expect(await processarCarrinho(admin, ORG, '9000', mais(20))).toBe('enviado');
    expect(m.log).toEqual(['update:{"status":"enviado","atualizado_em":"2026-10-24T17:00:20.000Z"}', 'notificar']);
    const claim = admin.ops.find((o: Op) => o.op === 'update');
    expect(claim).toBeDefined();
    expect(m.lerVendasDoCarrinho).toHaveBeenCalledWith(admin, ORG, { packId: 9000, orderId: 1 });
    expect(m.carregarContexto).toHaveBeenCalledWith(admin, ORG, '2026-10-24T00:00:00-03:00');
    expect(m.lerKpis.mock.calls.map((c) => c[2])).toEqual([
      { desde: '2026-10-24T00:00:00-03:00', ate: '2026-10-25T00:00:00-03:00' },
      { desde: '2026-10-01T00:00:00-03:00', ate: '2026-10-24T17:00:20.000Z' },
      { desde: '2026-09-01T00:00:00-03:00', ate: '2026-09-25T00:00:00-03:00' },
    ]);
    expect(m.montarMensagemCarrinho).toHaveBeenCalledWith(
      { venda: 100 },
      { hoje: KPI, mes: KPI, anterior: KPI, rotuloMes: 'Outubro', rotuloAnterior: '1–24/set' },
      9000, { parcial: null, composicaoIncerta: false },
    );
    expect(m.notificarCategoria).toHaveBeenCalledWith(admin, ORG, 'vendas_gerencial', 'TEXTO');
    expect(admin.linhas[0].status).toBe('enviado');
  });

  it('claim afeta 0 linhas (outro worker já enviou) → ignorado, sem notificar', async () => {
    prepararEnvio();
    m.lerVendasDoCarrinho.mockResolvedValue([venda(1), venda(2)]);
    const admin = fakeAdmin([linha()]);
    m.lerKpis.mockImplementation(async () => { admin.linhas[0].status = 'enviado'; return KPI; });
    expect(await processarCarrinho(admin, ORG, '9000', mais(20))).toBe('ignorado');
    expect(m.notificarCategoria).not.toHaveBeenCalled();
  });

  it('erro de leitura antes do claim lança e a linha continua aguardando', async () => {
    prepararEnvio();
    m.lerVendasDoCarrinho.mockResolvedValue([venda(1), venda(2)]);
    m.carregarContexto.mockRejectedValue(new Error('ContextoIndisponivel'));
    const admin = fakeAdmin([linha()]);
    await expect(processarCarrinho(admin, ORG, '9000', mais(20))).rejects.toThrow();
    expect(admin.linhas[0].status).toBe('aguardando');
    expect(m.notificarCategoria).not.toHaveBeenCalled();
  });

  it('aguardar: CAS em tentativas, tentativas + 1 e republica com o delay e o dedup novos', async () => {
    m.lerVendasDoCarrinho.mockResolvedValue([venda(1), venda(2, 'payment_required')]);
    const admin = fakeAdmin([linha({ tentativas: 2 })]);
    expect(await processarCarrinho(admin, ORG, '9000', mais(70))).toBe('aguardando');
    expect(admin.linhas[0]).toMatchObject({ tentativas: 3, status: 'aguardando', atualizado_em: mais(70).toISOString() });
    expect(m.publishJSON).toHaveBeenCalledWith(expect.objectContaining({
      body: { orgId: ORG, chave: '9000' }, delay: 60, deduplicationId: `carrinho-${ORG}-9000-3`,
    }));
  });

  it('aguardar com tentativas já avançadas por outro job → ignorado, sem republicar', async () => {
    m.lerVendasDoCarrinho.mockResolvedValue([venda(1)]);
    const admin = fakeAdmin([linha({ tentativas: 2 })]);
    m.lerVendasDoCarrinho.mockImplementation(async () => { admin.linhas[0].tentativas = 3; return [venda(1)]; });
    expect(await processarCarrinho(admin, ORG, '9000', mais(70))).toBe('ignorado');
    expect(m.publishJSON).not.toHaveBeenCalled();
  });

  it('prazo vencido sem nenhuma paga → descartado', async () => {
    m.lerVendasDoCarrinho.mockResolvedValue([]);
    const admin = fakeAdmin([linha()]);
    expect(await processarCarrinho(admin, ORG, '9000', mais(600))).toBe('descartado');
    expect(admin.linhas[0].status).toBe('descartado');
    expect(m.notificarCategoria).not.toHaveBeenCalled();
  });

  it('esperadas null e tentativas ≥ 1: tenta /packs com o token da conexão ML e grava', async () => {
    m.resolverConexao.mockResolvedValue({ id: 'c1' });
    m.getValidAccessTokenConexao.mockResolvedValue('tok');
    fetchMock.mockResolvedValue(packOk([1, 2]));
    m.lerVendasDoCarrinho.mockResolvedValue([venda(1)]);
    const admin = fakeAdmin([linha({ esperadas: null, tentativas: 1 })]);
    expect(await processarCarrinho(admin, ORG, '9000', mais(70))).toBe('aguardando');
    expect(m.resolverConexao).toHaveBeenCalledWith(admin, ORG, 'mercado_livre');
    expect(admin.linhas[0].esperadas).toEqual([1, 2]);
  });

  it('esperadas null e /packs falha: segue null sem lançar', async () => {
    m.resolverConexao.mockResolvedValue({ id: 'c1' });
    m.getValidAccessTokenConexao.mockRejectedValue(new Error('token'));
    m.lerVendasDoCarrinho.mockResolvedValue([venda(1)]);
    const admin = fakeAdmin([linha({ esperadas: null, tentativas: 1 })]);
    expect(await processarCarrinho(admin, ORG, '9000', mais(70))).toBe('aguardando');
    expect(admin.linhas[0].esperadas).toBeNull();
  });
});

describe('varrerCarrinhos', () => {
  const AGORA = new Date('2026-10-24T18:00:00.000Z');
  const velho = '2026-10-24T17:58:00.000Z';
  it('só publica o job individual das aguardando paradas há > 90 s', async () => {
    const admin = fakeAdmin([
      linha({ chave: '1', atualizado_em: velho, tentativas: 4 }),
      linha({ chave: '2', atualizado_em: velho }),
      linha({ chave: '3', atualizado_em: '2026-10-24T17:59:00.000Z' }),
      linha({ chave: '4', atualizado_em: velho, status: 'enviado' }),
    ]);
    expect(await varrerCarrinhos(admin, AGORA)).toBe(2);
    expect(m.batchJSON).toHaveBeenCalledTimes(1);
    expect(m.batchJSON.mock.calls[0][0]).toEqual([
      expect.objectContaining({ body: { orgId: ORG, chave: '1' }, deduplicationId: `carrinho-${ORG}-1-4` }),
      expect.objectContaining({ body: { orgId: ORG, chave: '2' }, deduplicationId: `carrinho-${ORG}-2-0` }),
    ]);
    expect(admin.ops[0].range).toEqual([0, 199]);
    expect(m.publishJSON).not.toHaveBeenCalled();
    expect(m.lerVendasDoCarrinho).not.toHaveBeenCalled();
  });

  it('lote cheio (200): publica a si mesma com o cursor; com cursor, filtra depois dele', async () => {
    const linhas = Array.from({ length: 201 }, (_, i) => linha({ chave: String(1000 + i), atualizado_em: velho }));
    const admin = fakeAdmin(linhas);
    expect(await varrerCarrinhos(admin, AGORA)).toBe(200);
    expect(m.batchJSON.mock.calls.flatMap((c) => c[0])).toHaveLength(200); // em blocos (enfileirarEmBlocos)
    expect(m.publishJSON).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://proj.supabase.co/functions/v1/notificar-carrinho',
      body: { varrer: true, depois: { orgId: ORG, chave: '1199' } },
    }));
    await varrerCarrinhos(admin, AGORA, { orgId: ORG, chave: '1199' });
    expect(admin.ops[1].or).toBe(`org_id.gt.${ORG},and(org_id.eq.${ORG},chave.gt.1199)`);
  });
});
