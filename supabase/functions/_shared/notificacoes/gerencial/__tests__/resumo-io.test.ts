import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  batchJSON: vi.fn(),
  notificarCategoria: vi.fn(),
  lerKpis: vi.fn(),
  carregarContexto: vi.fn(),
  lerVendasJanela: vi.fn(),
  resultadoPorItem: vi.fn(),
}));

vi.mock('../../../queue.ts', () => ({ qstashClient: () => ({ batchJSON: m.batchJSON }) }));
vi.mock('../../config.ts', () => ({ notificarCategoria: m.notificarCategoria }));
vi.mock('../kpis.ts', () => ({ lerKpis: m.lerKpis }));
vi.mock('../../../platform-admin/metrics-repository.ts', async (orig) => ({
  ...(await orig<object>()), carregarContexto: m.carregarContexto, lerVendasJanela: m.lerVendasJanela,
}));

vi.mock('../resultado.ts', async (orig) => ({ ...(await orig<object>()), resultadoPorItem: m.resultadoPorItem }));

import { VolumeAcimaDoLimite } from '../../../platform-admin/metrics-repository.ts';
import { contarPromocoesDoResumo, lerCatalogoEstoque, montarDadosResumo, orgsDoResumo, processarJobResumo } from '../resumo-io.ts';
import { selecionarAlertas } from '../../../promocoes/alertas.ts';
import { horaBrt, janela30Dias, janelaDia, janelasMesFechado } from '../janelas.ts';
import { fakeAdmin } from './fake-postgrest.ts';

const ORG = 'org-a';
const AGORA = new Date('2026-10-24T11:00:00Z'); // 08:00 BRT
const kpis = { faturamento: 100, pedidos: 2, ticket: 50 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('Deno', { env: { get: () => 'https://proj.supabase.co' } });
  m.batchJSON.mockImplementation(async (msgs: unknown[]) => msgs.map(() => ({ messageId: 'x' })));
  m.notificarCategoria.mockResolvedValue(1);
  m.lerKpis.mockResolvedValue(kpis);
  m.carregarContexto.mockResolvedValue({ maps: undefined, rates: null, custosOk: true, configOk: false });
  m.lerVendasJanela.mockResolvedValue([]);
  m.resultadoPorItem.mockReturnValue([]);
});
afterEach(() => vi.unstubAllGlobals());

const profiles = [
  { id: 'p1', org_id: ORG, is_active: true, is_admin: true, telegram_categorias: ['resumo_diario'] },
  { id: 'p2', org_id: ORG, is_active: true, is_admin: true, telegram_categorias: ['resumo_diario', 'vendas'] },
  { id: 'p3', org_id: 'org-inativo', is_active: false, is_admin: true, telegram_categorias: ['resumo_diario'] },
  { id: 'p4', org_id: 'org-membro', is_active: true, is_admin: false, telegram_categorias: ['resumo_diario'] },
  { id: 'p5', org_id: 'org-vendas', is_active: true, is_admin: true, telegram_categorias: ['vendas_gerencial'] },
];

describe('orgsDoResumo', () => {
  it('org com Telegram desligado entra se um admin ativo assina resumo_diario (in-app vale)', async () => {
    const admin = fakeAdmin({ profiles, configuracoes: [{ org_id: ORG, telegram_ativo: false }] });
    await expect(orgsDoResumo(admin)).resolves.toEqual([ORG]);
    const q = admin.consultas.find((c: any) => c.tabela === 'profiles');
    expect(q.range).toEqual([0, 999]);
  });
});

describe('contarPromocoesDoResumo', () => {
  const agoraMs = AGORA.getTime();
  const promos = [
    { org_id: ORG, promocao_id: 'P1', nome: 'P1', status: 'started', prazo_adesao: null, contagem: null },
    { org_id: ORG, promocao_id: 'P2', nome: 'P2', status: 'finished', prazo_adesao: null, contagem: null }, // encerrada
    { org_id: ORG, promocao_id: 'P3', nome: 'P3', status: 'pending', prazo_adesao: new Date(agoraMs + 24 * 3_600_000).toISOString(), contagem: { convidados_verde: 2 } },
    { org_id: ORG, promocao_id: 'P4', nome: 'P4', status: 'pending', prazo_adesao: new Date(agoraMs + 72 * 3_600_000).toISOString(), contagem: { convidados_verde: 2 } },
  ];
  const itens = [
    ...Array.from({ length: 700 }, (_, i) => ({ org_id: ORG, promocao_id: 'P1', ml_item_id: `MLB${i}`, status: 'started', pior_semaforo: 'vermelho', titulo: null, preco_avaliado: null, projecao: [] })),
    { org_id: ORG, promocao_id: 'P2', ml_item_id: 'MLBX', status: 'started', pior_semaforo: 'vermelho', titulo: null, preco_avaliado: null, projecao: [] },
    { org_id: ORG, promocao_id: 'P1', ml_item_id: 'MLBV', status: 'started', pior_semaforo: 'verde', titulo: null, preco_avaliado: null, projecao: [] },
    { org_id: ORG, promocao_id: 'P1', ml_item_id: 'MLBF', status: 'finished', pior_semaforo: 'vermelho', titulo: null, preco_avaliado: null, projecao: [] },
  ];

  it('700 no prejuízo (sem teto de 500); item de promoção encerrada não conta, como selecionarAlertas', async () => {
    const admin = fakeAdmin({ ml_promocoes: promos, ml_promocao_itens: itens });
    const r = await contarPromocoesDoResumo(admin, ORG, agoraMs);

    // referência: os filtros de depsAlertas (alertas.ts:85-95) sem o limit, passados ao selecionarAlertas real
    const promosRef = promos.filter((p) => ['pending', 'started'].includes(p.status));
    const itensRef = itens.filter((i) => ['started', 'pending'].includes(i.status) && i.pior_semaforo === 'vermelho');
    const ref = selecionarAlertas(promosRef as any, itensRef as any, agoraMs);
    expect(r).toEqual({ prejuizo: 700, prazo: 1 });
    expect(r.prejuizo).toBe(ref.prejuizo.length);
    expect(r.prazo).toBe(ref.prazo.length);

    const count = admin.consultas.find((c: any) => c.tabela === 'ml_promocao_itens');
    expect(count.head).toBe(true);
    expect(count.select).toContain('ml_promocoes!inner');
  });
});

describe('montarDadosResumo', () => {
  const dia = '2026-10-23';
  const notif = (chave: string, enviado_em: string, extra = {}) => ({ org_id: ORG, entidade: 'frete_subiu', chave, enviado_em, ...extra });
  const venda = (order_id: number, titulo: string, org_id = ORG) => ({ org_id, order_id, itens: [{ titulo }] });
  const tabelas = (modulos: string[]) => ({
    organizations: [{ id: ORG, modulos_habilitados: modulos }],
    ml_notificacoes_enviadas: [
      notif('1', '2026-10-23T03:00:00Z'), // 00:00 BRT: entra
      notif('2', '2026-10-23T12:00:00Z'),
      notif('3', '2026-10-23T13:00:00Z'), // mesmo título do 2
      notif('4', '2026-10-23T14:00:00Z'),
      notif('5', '2026-10-23T15:00:00Z'),
      notif('6', '2026-10-23T16:00:00Z'),
      notif('7', '2026-10-23T17:00:00Z'),
      notif('8', '2026-10-24T03:00:00Z'), // 24/10 00:00 BRT: fora
      notif('9', '2026-10-23T12:00:00Z', { entidade: 'venda_paga' }),
      notif('10', '2026-10-23T12:00:00Z', { org_id: 'org-b' }),
    ],
    ml_vendas: [
      venda(1, 'Camisa'), venda(2, 'Bermuda'), venda(3, 'Bermuda'), venda(4, 'Tênis'), venda(5, 'Boné'),
      venda(6, 'Meia'), venda(7, 'Cinto'), venda(8, 'Fora'), venda(9, 'Venda'), venda(10, 'Outra org', 'org-b'),
      venda(1, 'Outra org mesmo pedido', 'org-b'),
    ],
  });

  it('sem módulo promocoes → null; frete subiu: títulos distintos do dia, no máximo 5; alíquota não confirmada', async () => {
    const admin = fakeAdmin(tabelas([]));
    const d = await montarDadosResumo(admin, ORG, dia, AGORA);

    expect(d.promocoes).toBeNull();
    expect(d.freteSubiu).toEqual(['Camisa', 'Bermuda', 'Tênis', 'Boné', 'Meia']);
    expect(d.lucroOntem.lucro).toBeNull();
    expect(d.lucroOntem.motivo).toBe('aliquota_nao_confirmada');
    expect(d.dia).toBe(dia);
    expect(d.apuradoAte).toBe(horaBrt(AGORA));
    expect(d.devolucoes).toEqual({ estornado: 0, prazoProximo: 0 });
    expect(d.atencao).toEqual({ abaixoMinimo: 0, prejuizo: 0, semCusto: 0, prejuizos: [] });

    const jm = janelasMesFechado(dia);
    expect(m.lerKpis).toHaveBeenCalledWith(admin, ORG, janelaDia(dia));
    expect(m.lerKpis).toHaveBeenCalledWith(admin, ORG, jm.mes);
    expect(m.lerKpis).toHaveBeenCalledWith(admin, ORG, jm.anterior);
    expect(m.lerVendasJanela).toHaveBeenCalledWith(admin, ORG, janelaDia(dia));
    expect(d.rotuloMes).toBe(jm.rotuloMes);
    expect(d.rotuloAnterior).toBe(jm.rotuloAnterior);
    expect(admin.consultas.some((c: any) => c.tabela.startsWith('ml_promoc'))).toBe(false);
  });

  it('com módulo promocoes → contagens', async () => {
    const admin = fakeAdmin({ ...tabelas(['promocoes']), ml_promocoes: [], ml_promocao_itens: [] });
    const d = await montarDadosResumo(admin, ORG, dia, AGORA);
    expect(d.promocoes).toEqual({ prejuizo: 0, prazo: 0 });
  });
});

describe('estoque acabando e nomes do prejuízo (fase 1)', () => {
  const dia = '2026-10-23';
  const OUTRA = 'org-b';
  const V_ONTEM = [{ marca: 'ontem' }];
  const V30 = [
    { order_id: 1, date_closed: '2026-10-20T15:00:00Z' },
    { order_id: 2, date_closed: '2026-10-21T15:00:00Z' },
    { order_id: 3, date_closed: '2026-10-22T15:00:00Z' },
  ];
  const item = (extra = {}) => ({
    orderId: 1, packChave: '1', codigo: 'A', titulo: 'Camisa Azul', quantidade: 1, venda: 20, liquido: 20, imposto: 0,
    impostoOk: true, custo: 5, custoEstimado: false, faturavel: true, freteNaoLido: false, lucro: 10, ...extra,
  });
  const itens30 = [1, 2, 3].map((orderId) => item({ orderId }));
  const prejuizo = (extra = {}) => item({ orderId: 9, codigo: 'P', titulo: 'Tênis Prejuízo', liquido: 10, custo: 50, lucro: -40, ...extra });
  const fam = (id: string, extra = {}) => ({ id, org_id: ORG, nome_pai: 'Camisa', kit_multiplicador: null, criado_em: '2026-01-01T00:00:00Z', ...extra });
  const vari = (codigo: string, familia_id: string, extra = {}) => ({ org_id: ORG, codigo, nome: 'Azul', estoque: 0, familia_id, ...extra });
  const base = (extra: Record<string, any[]> = {}) => ({
    organizations: [{ id: ORG, modulos_habilitados: [] }], ml_notificacoes_enviadas: [], ml_vendas: [],
    familias: [fam('f1')], variacoes: [vari('A', 'f1')], ...extra,
  });
  const quebrar = (admin: any, tabela: string) => {
    const from = admin.from;
    const falha: any = new Proxy({}, { get: (_, k) => (k === 'then' ? (r: any) => r({ data: null, error: { message: 'boom' } }) : () => falha) });
    admin.from = (t: string) => (t === tabela ? falha : from(t));
    return admin;
  };
  const prepara = (ontem: unknown[] = [], trinta: unknown[] = itens30) => {
    m.lerVendasJanela.mockImplementation(async (_d: unknown, _o: string, j: { desde: string }) =>
      j.desde === janelaDia(dia).desde ? V_ONTEM : V30);
    m.resultadoPorItem.mockImplementation((v: unknown) => (v === V_ONTEM ? ontem : trinta));
  };

  it('campeão zerado com venda recente → entra; lê a janela de 30 dias com o contexto dela', async () => {
    prepara();
    const admin = fakeAdmin(base());
    const d = await montarDadosResumo(admin, ORG, dia, AGORA);
    expect(d.estoque).toHaveLength(1);
    expect(d.estoque![0]).toMatchObject({ codigo: 'A', zerado: true, estoque: 0, nome: 'Camisa · Azul' });
    const j30 = janela30Dias(dia);
    expect(m.lerVendasJanela).toHaveBeenCalledWith(admin, ORG, j30);
    expect(m.carregarContexto).toHaveBeenCalledWith(admin, ORG, j30.desde);
  });

  it('org sem nenhuma venda em 30 dias → estoque [] e resumo normal', async () => {
    prepara([], []);
    const d = await montarDadosResumo(fakeAdmin(base()), ORG, dia, AGORA);
    expect(d.estoque).toEqual([]);
    expect(d.ontem).toEqual(kpis);
  });

  it('leitura de 30 dias falha → estoque null, resto igual', async () => {
    prepara();
    m.lerVendasJanela.mockImplementation(async (_d: unknown, _o: string, j: { desde: string }) => {
      if (j.desde === janelaDia(dia).desde) return V_ONTEM;
      throw new Error('banco fora');
    });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = await montarDadosResumo(fakeAdmin(base()), ORG, dia, AGORA);
    expect(d.estoque).toBeNull();
    expect(d.ontem).toEqual(kpis);
    expect(d.atencao).toEqual({ abaixoMinimo: 0, prejuizo: 0, semCusto: 0, prejuizos: [] });
    expect(erro).toHaveBeenCalledWith('resumo_estoque_indisponivel', 'leitura', expect.any(Error));
    erro.mockRestore();
  });

  it('5.001 vendas na janela de 30 dias (VolumeAcimaDoLimite) → estoque null, resto igual', async () => {
    m.lerVendasJanela.mockImplementation(async (_d: unknown, _o: string, j: { desde: string }) => {
      if (j.desde === janelaDia(dia).desde) return V_ONTEM;
      throw new VolumeAcimaDoLimite('5001 vendas na janela (teto 5000)');
    });
    m.resultadoPorItem.mockReturnValue([]);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = await montarDadosResumo(fakeAdmin(base()), ORG, dia, AGORA);
    expect(d.estoque).toBeNull();
    expect(d.ontem).toEqual(kpis);
    expect(erro).toHaveBeenCalledWith('resumo_estoque_indisponivel', 'volume', expect.any(VolumeAcimaDoLimite));
    erro.mockRestore();
  });

  it('ontem acima do limite continua propagando', async () => {
    m.lerVendasJanela.mockRejectedValue(new VolumeAcimaDoLimite('ontem'));
    await expect(montarDadosResumo(fakeAdmin(base()), ORG, dia, AGORA)).rejects.toBeInstanceOf(VolumeAcimaDoLimite);
  });

  it('falha só do catálogo → estoque null; prejuízo nomeado pelo título', async () => {
    prepara([prejuizo()]);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const admin = quebrar(fakeAdmin(base({ variacoes: [vari('P', 'f1')] })), 'variacoes');
    // lerPisos também usa `variacoes`: o prejuízo de ontem é lido com piso zerado só se a leitura passar
    const original = admin.from;
    let n = 0;
    admin.from = (t: string) => (t === 'variacoes' && n++ === 0 ? fakeAdmin(base({ variacoes: [] })).from(t) : original(t));
    const d = await montarDadosResumo(admin, ORG, dia, AGORA);
    expect(d.estoque).toBeNull();
    expect(d.atencao.prejuizos).toEqual([{ nome: 'Tênis Prejuízo', valor: -40, vendas: 1 }]);
    expect(erro).toHaveBeenCalledWith('resumo_estoque_indisponivel', 'catalogo', expect.any(Error));
    erro.mockRestore();
  });

  it('prejuízo: nomeSku do catálogo; sem catálogo → título; sem título → código; sem nada → "item sem código"', async () => {
    prepara([
      prejuizo({ orderId: 11, codigo: 'A', titulo: 'Título ML' }),
      prejuizo({ orderId: 12, codigo: 'Z', titulo: null }),
      prejuizo({ orderId: 13, codigo: 'Y', titulo: 'Só título' }),
      prejuizo({ orderId: 14, codigo: null, titulo: null }),
    ], []);
    const d = await montarDadosResumo(fakeAdmin(base()), ORG, dia, AGORA);
    const nomes = Object.fromEntries(d.atencao.prejuizos.map((p) => [p.nome, p.vendas]));
    expect(Object.keys(nomes).sort()).toEqual(['Camisa · Azul', 'Só título', 'Z', 'item sem código'].sort());
  });

  it('kit (kit_multiplicador) e estoque nulo ficam fora', async () => {
    m.lerVendasJanela.mockImplementation(async (_d: unknown, _o: string, j: { desde: string }) => (j.desde === janelaDia(dia).desde ? V_ONTEM : V30));
    const trinta = [
      ...[1, 2, 3].map((orderId) => item({ orderId, codigo: 'K' })),
      ...[1, 2, 3].map((orderId) => item({ orderId, codigo: 'N' })),
    ];
    m.resultadoPorItem.mockImplementation((v: unknown) => (v === V_ONTEM ? [] : trinta));
    const admin = fakeAdmin(base({
      familias: [fam('fk', { kit_multiplicador: 3 }), fam('fn')],
      variacoes: [vari('K', 'fk'), vari('N', 'fn', { estoque: null })],
    }));
    const d = await montarDadosResumo(admin, ORG, dia, AGORA);
    expect(d.estoque).toEqual([]);
  });
});

describe('lerCatalogoEstoque', () => {
  const fam = (id: string, org_id: string, criado_em: string, extra = {}) => ({ id, org_id, nome_pai: `Fam ${id}`, kit_multiplicador: null, criado_em, ...extra });
  const vari = (codigo: string, familia_id: string, org_id = ORG, extra = {}) => ({ org_id, codigo, nome: null, estoque: 4, familia_id, ...extra });

  it('canônica = família mais nova; empate de data → maior id; nome cai para o da família', async () => {
    const admin = fakeAdmin({
      familias: [fam('a', ORG, '2026-01-01T00:00:00Z'), fam('b', ORG, '2026-03-01T00:00:00Z'), fam('c', ORG, '2026-03-01T00:00:00Z'), fam('d', ORG, '2026-02-01T00:00:00Z')],
      variacoes: [vari('X', 'a'), vari('X', 'c'), vari('X', 'b'), vari('Y', 'a'), vari('Y', 'd')],
    });
    const cat = await lerCatalogoEstoque(admin, ORG, ['X', 'Y']);
    expect(cat.get('X')).toEqual({ codigo: 'X', estoque: 4, ehKit: false, nome: 'Fam c', nomeFamilia: 'Fam c' });
    expect(cat.get('Y')?.nomeFamilia).toBe('Fam d');
  });

  it('mesmo código em outra org não vaza (variação nem família)', async () => {
    const admin = fakeAdmin({
      familias: [fam('a', ORG, '2026-01-01T00:00:00Z'), fam('z', 'org-b', '2026-09-01T00:00:00Z'), fam('w', 'org-b', '2026-09-01T00:00:00Z')],
      variacoes: [vari('X', 'a'), vari('X', 'z', 'org-b'), vari('X', 'w', ORG)], // `w`: variação da org, família de outra
    });
    const cat = await lerCatalogoEstoque(admin, ORG, ['X']);
    expect(cat.get('X')?.nomeFamilia).toBe('Fam a');
  });

  it('estoque nulo preservado, kit marcado por kit_multiplicador, lotes de 50 e erro lança', async () => {
    const admin = fakeAdmin({
      familias: [fam('a', ORG, '2026-01-01T00:00:00Z', { kit_multiplicador: 2 }), fam('b', ORG, '2026-01-01T00:00:00Z')],
      variacoes: [vari('K', 'a', ORG, { estoque: null }), vari('N', 'b')],
    });
    const codigos = ['K', 'N', ...Array.from({ length: 100 }, (_, i) => `C${i}`)];
    const cat = await lerCatalogoEstoque(admin, ORG, codigos);
    expect(cat.get('K')).toMatchObject({ estoque: null, ehKit: true });
    expect(cat.get('N')).toMatchObject({ estoque: 4, ehKit: false });
    expect(admin.consultas.filter((c: any) => c.tabela === 'variacoes')).toHaveLength(3);

    const falha: any = new Proxy({}, { get: (_, k) => (k === 'then' ? (r: any) => r({ data: null, error: { message: 'boom' } }) : () => falha) });
    await expect(lerCatalogoEstoque({ from: () => falha } as any, ORG, ['K'])).rejects.toThrow('boom');
  });
});

describe('processarJobResumo (roteamento)', () => {
  it('disparo sem orgId → um job por org com o dia anterior calculado no disparo', async () => {
    const admin = fakeAdmin({ profiles });
    await processarJobResumo(admin, {}, AGORA);
    expect(m.batchJSON).toHaveBeenCalledWith([{
      url: 'https://proj.supabase.co/functions/v1/resumo-diario',
      body: { orgId: ORG, dia: '2026-10-23' }, retries: 3, deduplicationId: 'resumo-diario-org-a-2026-10-23',
    }]);
    // 23:00 BRT de 23/10 (02:00 UTC de 24/10) → ontem é 22/10
    await processarJobResumo(admin, {}, new Date('2026-10-24T02:00:00Z'));
    expect(m.batchJSON.mock.calls[1][0][0].body.dia).toBe('2026-10-22');
    expect(m.notificarCategoria).not.toHaveBeenCalled();
  });

  it('job da org processado em 25/10 ainda resume o dia do body (23/10)', async () => {
    const admin = fakeAdmin({ organizations: [{ id: ORG, modulos_habilitados: [] }] });
    await processarJobResumo(admin, { orgId: ORG, dia: '2026-10-23' }, new Date('2026-10-25T11:00:00Z'));
    expect(m.lerVendasJanela).toHaveBeenCalledWith(admin, ORG, janelaDia('2026-10-23'));
    expect(m.notificarCategoria).toHaveBeenCalledTimes(1);
    const [, org, categoria, texto, opcoes] = m.notificarCategoria.mock.calls[0];
    expect([org, categoria, opcoes]).toEqual([ORG, 'resumo_diario', { chave: 'resumo_diario:2026-10-23' }]);
    expect(texto).toMatch(/^📊 Ontem · 23\/10/);
    expect(texto).toContain('Apurado às 08:00');
    expect(m.batchJSON).not.toHaveBeenCalled();
  });
});
